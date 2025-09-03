#!/usr/bin/python
import os
import sys
import json
import re
import time
import unicodedata
from datetime import datetime, timedelta

import lxml.html
from dateutil import parser
import pytz
from urlextract import URLExtract
from curl_cffi import requests

headers = {
    "Referer": "https://programme.openhouse.org.uk/",
}

proxy = os.getenv("PROXY")

cookies = {}
session_cookie = os.getenv("OH_SESSION_COOKIE")
if session_cookie:
    print("Using session cookie...")
    cookies = {"_session_id": session_cookie}
else:
    print(
        "NOT using session cookie - this will not have accurate booking status data..."
    )
    cookies = {"_session_id": "no_session"}

year = int(os.environ["YEAR"])
os.makedirs(f"data/{year}", exist_ok=True)

timezone = pytz.timezone("Europe/London")

existing_venues = []
for venue_fname in os.listdir(f"data/{year}/"):
    if venue_fname.endswith(".json"):
        existing_venues.append(int(venue_fname.split(".")[0]))

print(f"Found {len(existing_venues)} existing venues for {year}")

buildings = []
response = requests.get(
    "https://programme.openhouse.org.uk/map",
    headers=headers,
    impersonate="chrome",
    proxy=proxy,
)
root = lxml.html.document_fromstring(response.content)
marker_nodes = root.xpath('//ul[@class="markers"]/li')
for node in marker_nodes:
    buildings.append(
        {
            "id": int(
                node.attrib["data-url"].replace(
                    "https://programme.openhouse.org.uk/map/", ""
                )
            ),
            "name": node.text_content().strip(),
        }
    )

if len(buildings) == 0:
    print("ERROR: No buildings found")
    sys.exit(1)


scraped_venues = []
venues_added_days = {}
venues_now_bookable = []

scrape_start = datetime.now()
count = 0

for building in buildings:
    count += 1
    print(f"Fetching listing {count}/{len(buildings)} - {building}")

    venue_file = f'data/{year}/{building["id"]}.json'
    original_url = f'https://programme.openhouse.org.uk/listings/{building["id"]}'

    while True:
        try:
            response = requests.get(
                original_url,
                cookies=cookies,
                headers=headers,
                impersonate="chrome",
                proxy=proxy,
            )
            if response.content == b"Retry later\n" or response.status_code == 503:
                sleep_until = datetime.now() + timedelta(minutes=10)
                print(
                    f"!! Hit rate limiting, having a little sleep until {sleep_until}"
                )
                time.sleep(10 * 60)
            else:
                break

        except requests.errors.RequestsError as e:
            print(f"!!? Failed to fetch listing page, trying again in 10s: '{e}'")
            time.sleep(10)

    if response.status_code == 500:
        print(
            "SKIPPING due to 500 response from server - likely this listing isn't public yet"
        )
        continue
    if response.status_code == 404:
        print(
            "SKIPPING due to 404 response from server - likely this listing has been removed"
        )
        continue
    if b"Listing withdrawn" in response.content:
        print("SKIPPING as listing has been withdrawn for this year")
        continue

    if session_cookie and b"Log out" not in response.content:
        print(
            "!! Invalid session cookie, cannot continue without scraping incorrect data"
        )
        print(response.status_code)
        print(response.content)
        raise Exception("Invalid session cookie")

    # OH now reissues a time-limited cookie on each page load
    cookies = {"_session_id": response.cookies["_session_id"]}

    root = lxml.html.document_fromstring(response.content)

    data = {
        "id": building["id"],
        "original_url": original_url,
        "name": building["name"],
        "location": {
            "latitude": None,
            "longitude": None,
            "address": None,
            "travel_info": [],
            "meeting_point": None,  # Not used anymore, preserved for backward compat
        },
        "images": [],
        "facilities": [],
        "links": [],
        "design": {
            "designers": [],
            "types": [],
            "periods": [],
        },
        "factsheet": [],
        "events": [],
        "all_week": False,  # Not used anymore, preserved for backward compat
        "ticketed_events": False,
        "balloted_events": False,
        "new_venue_this_year": True,
        "first_published": None,
        "venue_years_listed": [],
    }

    data["first_published"] = scrape_start.isoformat()

    # If we already have data for this venue to persist
    existing_data = {}
    if building["id"] in existing_venues:
        with open(venue_file, "r") as f:
            existing_data = json.load(f)

        print(" - Found existing data")

        # first_published may not exist in earlier data
        if "first_published" in existing_data:
            data["first_published"] = existing_data["first_published"]

    # Images
    image_nodes = root.xpath('//*[contains(@id, "photo-")]/img')
    if image_nodes:
        for image in image_nodes:
            data["images"].append(
                {
                    "url": image.attrib["src"],
                    "title": image.attrib.get("alt", None),
                    "description": None,
                }
            )

    # Images are fetched and stored by https://github.com/infrastructureclub/open-house-london-images
    for image in data["images"]:
        image["archive_url"] = None
        # For some baffling reason some of the images refer to a broken relative path
        if image["url"].startswith("http"):
            image["archive_url"] = (
                "https://raw.githubusercontent.com/infrastructureclub/open-house-london-images/master/images/%s/%s/%s"
                % (year, building["id"], os.path.basename(image["url"]))
            )

    # Address + location
    address_nodes = root.xpath('//p[contains(@class, "address")]/text()')
    data["location"]["address"] = address_nodes[0].strip()

    # The map link now only exists if you have JS on, there is no non-JS default /o\
    lat_lon_matches = re.search(
        r'"https://www.openstreetmap.org/#map=18/(-?\d+\.\d+)/(-?\d+\.\d+)"',
        str(response.content),
    )
    data["location"]["latitude"] = float(lat_lon_matches.group(1))
    data["location"]["longitude"] = float(lat_lon_matches.group(2))

    travel_and_facilities_prefix = (
        '//section[contains(@class, "oc-listing-details")]/div'
    )

    # Travel info
    travel_titles = root.xpath(travel_and_facilities_prefix + "[2]/h4")
    travel_ps = root.xpath(travel_and_facilities_prefix + "[2]/p")
    for node in zip(travel_titles, travel_ps):
        data["location"]["travel_info"].append(
            f"{node[0].text_content()}: {node[1].text_content()}"
        )

    # Facilities
    for node in root.xpath(travel_and_facilities_prefix + "[3]/ul/li"):
        data["facilities"].append(node.text_content())

    # Short description
    description_nodes = root.xpath('//p[contains(@class, "description")]')
    data["description"] = description_nodes[0].text_content().strip()

    # Design notes + tags
    intro_prefix = '//section[contains(@class, "oc-listing-intro")]/div'
    architect_and_year_node = root.xpath(intro_prefix + "/p[2]")
    architects = []
    if architect_and_year_node:
        architect_and_year_bits = architect_and_year_node[0].text_content().split(",")
        architects = [a.strip() for a in architect_and_year_bits[:-1]]
        design_year = architect_and_year_bits[-1].strip()
        for architect in architects:
            data["design"]["designers"].append(
                {
                    "description": None,  # Not used anymore, preserved for backward compat
                    "architect": architect,
                    "year": design_year,  # Ugggh, they didn't all do it in the same year but what am I supposed to do
                }
            )

    design_types = root.xpath(
        '//section[contains(@class, "oc-listing-intro")]//p[contains(@class, "building-types")]'
    )
    data["design"]["types"] = design_types[0].text_content().strip().split(", ")

    # For some reason periods are now only in the meta keywords so we have to demangle them from that
    design_types = root.xpath('//meta[contains(@name, "keywords")]')[0].attrib[
        "content"
    ]
    data["design"]["periods"] = [
        t.strip()
        for t in design_types.split(",")
        if (t not in architects)
        and (t.lower() not in data["design"]["types"])
        and t.strip()
    ]

    # Big free text section at the bottom, they call it the factsheet
    for heading in root.xpath('//section[contains(@class, "oc-listing-about")]//h3'):
        paragraphs = []
        for sibling in heading.xpath(".//following-sibling::*"):
            if sibling.tag == "p":
                paragraphs.append(sibling.text_content().strip())
            elif sibling.tag == "h3":
                break

        data["factsheet"].append(
            {
                "heading": heading.text_content().strip(),
                "paragraphs": paragraphs,
            }
        )

    # External links
    for link in root.xpath('//section[contains(@class, "oc-listing-websites")]//a'):
        data["links"].append(
            {
                "href": link.attrib["href"],
                "title": link.text_content(),
            }
        )

    # External links referenced in the factsheet (mostly websites and ticketing)
    links_ticketed = False
    extractor = URLExtract()
    for block in data["factsheet"]:
        for paragraph in block["paragraphs"]:
            for href in extractor.find_urls(paragraph):
                data["links"].append(
                    {
                        "href": href,
                        "title": None,
                    }
                )

    for link in data["links"]:
        if "eventbrite" in link["href"]:
            links_ticketed = True

    # Events, oh no
    events_ticketed = False
    balloted_events = False

    # Drop in events
    drop_in_node = root.xpath(
        '//section[contains(@class, "oc-listing-activities")]//h2[text()="Drop in activities"]'
    )
    if drop_in_node:
        date_nodes = drop_in_node[0].xpath(".//following-sibling::h3")
        events_nodes = drop_in_node[0].xpath(
            './/following-sibling::div[contains(@class, "items")]'
        )
        for date_node, event_node in zip(date_nodes, events_nodes):
            date_string = date_node.text_content().strip()
            date = parser.parse(date_string).date()

            for event in event_node.xpath('.//div[@class="item"]'):
                name = event.xpath('.//h3[@class="text"]/text()')[0]

                capacity = None
                capacity_node = event.xpath('.//p[contains(@class, "capacity")]/text()')
                if capacity_node:
                    matches = re.search(r"(\d+)", capacity_node[0])
                    capacity = int(matches.group(1))

                notes_node = event.xpath('.//p[contains(@class, "text")]/text()')
                notes = ""
                if notes_node:
                    notes = notes_node[0]

                time_string = event.xpath(".//p[not(@*)]")[0].text_content()
                time_string = unicodedata.normalize("NFKD", time_string)

                all_day = False
                if time_string == "All day":
                    all_day = True
                    # To make using the data easier, fake out the times
                    start_time = "00:00"
                    end_time = "23:59"
                else:
                    start_time, end_time = time_string.split("–")

                start_datetime = parser.parse(date_string + " " + start_time)
                start_datetime = timezone.localize(start_datetime)
                end_datetime = parser.parse(date_string + " " + end_time)
                end_datetime = timezone.localize(end_datetime)

                data["events"].append(
                    {
                        "date": date.isoformat(),
                        "start": start_datetime.isoformat(),
                        "end": end_datetime.isoformat(),
                        "all_day": all_day,
                        "activity_type": "Drop in",
                        "name": name,
                        "capacity": capacity,
                        "notes": notes,
                        "fully_booked": False,
                        "ticketed": False,
                        "booking_link": None,
                        "drop_in": True,
                        "balloted": False,
                    }
                )

    # Not drop-in events
    events_node = root.xpath(
        '//section[contains(@class, "oc-listing-activities")]//h2[text()="Activities"]'
    )

    bookable_count = 0
    fully_booked_count = 0

    if events_node:
        events_ticketed = True

        date_nodes = events_node[0].xpath(".//following-sibling::h3")
        events_nodes = events_node[0].xpath(
            './/following-sibling::div[contains(@class, "items")]'
        )
        for date_node, event_node in zip(date_nodes, events_nodes):
            date_string = date_node.text_content().strip()
            date = parser.parse(date_string).date()

            for event in event_node.xpath('.//div[@class="item"]'):
                activity_type = event.xpath(
                    './/p[contains(@class, "uppercase")]/text()'
                )[0]
                time_string = event.xpath(".//p[not(@*)]")[0].text_content()
                name = event.xpath('.//h3[@class="text"]/text()')[0]

                notes_node = event.xpath('.//p[@class="text"]/text()')
                notes = ""
                if notes_node:
                    notes = notes_node[0]

                booking_buttons = event.xpath('.//button[@name="button"]')
                fully_booked = False
                balloted = False

                if booking_buttons:
                    booking_string = booking_buttons[0].text_content().strip()
                    if "full" in booking_string.lower():
                        fully_booked = True
                        fully_booked_count += 1

                    if "ballot" in booking_string.lower():
                        balloted = True
                        balloted_events = True

                        if booking_buttons[0].attrib["disabled"] == "disabled":
                            fully_booked = True
                            fully_booked_count += 1

                    if not fully_booked:
                        bookable_count += 1

                all_day = False
                if time_string.lower() == "all day":
                    all_day = True
                    # To make using the data easier, fake out the times
                    start_time = "00:00"
                    end_time = "23:59"
                else:
                    start_time, end_time = time_string.split("–")

                start_datetime = parser.parse(date_string + " " + start_time)
                start_datetime = timezone.localize(start_datetime)
                end_datetime = parser.parse(date_string + " " + end_time)
                end_datetime = timezone.localize(end_datetime)

                data["events"].append(
                    {
                        "date": date.isoformat(),
                        "start": start_datetime.isoformat(),
                        "end": end_datetime.isoformat(),
                        "all_day": all_day,
                        "activity_type": activity_type,
                        "name": name,
                        "capacity": None,
                        "notes": notes,
                        "fully_booked": fully_booked,
                        "ticketed": True,
                        "booking_link": original_url,
                        "drop_in": False,
                        "balloted": balloted,
                    }
                )

    if links_ticketed or events_ticketed:
        data["ticketed_events"] = True

    data["balloted_events"] = balloted_events

    # Detect a venue no longer being fully booked for the summary
    if data["ticketed_events"]:
        previously_fully_booked = True
        if existing_data:
            for event in existing_data["events"]:
                if event["ticketed"] and not event["fully_booked"]:
                    previously_fully_booked = False
                    break

        if bookable_count > 0 and previously_fully_booked:
            venues_now_bookable.append(data["id"])

    # Detect a venue adding new days for the summary
    current_dates = {e["date"] for e in data.get("events", [])}
    previous_dates = {e["date"] for e in existing_data.get("events", [])}
    new_days = current_dates - previous_dates
    if len(new_days) > 0:
        venues_added_days[data["id"]] = new_days

    # Detect new venues, previous years exhibited
    for previous_year in sorted(os.listdir("data/")):
        previous_year = int(previous_year)
        if os.path.exists(f"data/{previous_year}/{data['id']}.json"):
            data["venue_years_listed"].append(previous_year)
            if previous_year != year:
                data["new_venue_this_year"] = False

    # If we just scraped this for the first time the file for this year doesn't
    # exist yet so ensure we add this year to reduce commitspam
    if year not in data["venue_years_listed"]:
        data["venue_years_listed"].append(year)

    with open(venue_file, "w", encoding="utf8") as f:
        f.write(
            json.dumps(
                data,
                indent=4,
                sort_keys=True,
                separators=(",", ": "),
                ensure_ascii=False,
            )
        )

    print(
        f" - Found {len(data['events'])} events ({bookable_count} bookable, {fully_booked_count} fully booked)"
    )
    scraped_venues.append(data["id"])

    time.sleep(1)

# Remove all venues that we didn't see this time, or we failed to scrape
venues_to_remove = set(existing_venues) - set(scraped_venues)
print(f"* Removing venues that no longer exist: {venues_to_remove}")
for venue in venues_to_remove:
    os.remove(f"data/{year}/{venue}.json")

os.makedirs(f"scrape_summaries/{year}", exist_ok=True)
with open(f"scrape_summaries/{year}/{scrape_start:%Y-%m-%d_%H%M}.json", "w") as f:
    venues_added = set(scraped_venues) - set(existing_venues)
    scrape_summary = {
        "removed_venues": list(venues_to_remove),
        "added_venues": list(venues_added),
        "venues_added_days": venues_added_days,
        "venues_now_bookable": venues_now_bookable,
    }

    f.write(
        json.dumps(
            scrape_summary,
            indent=4,
            sort_keys=True,
            separators=(",", ": "),
            ensure_ascii=False,
        )
    )
