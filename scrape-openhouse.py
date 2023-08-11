#!/usr/bin/python
import os
import sys
import json
import re
import time

import requests
import lxml.html
from dateutil import parser
import pytz
from urlextract import URLExtract

headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36'
}

cookies = {}
session_cookie = os.getenv("OH_SESSION_COOKIE")
if session_cookie:
    print("Using session cookie...")
    cookies = {"_open_house_session": session_cookie}
else:
    print(
        "NOT using session cookie - this will not have accurate booking status data..."
    )

year = 2022
timezone = pytz.timezone("Europe/London")

buildings = []
response = requests.get("https://programme.openhouse.org.uk/map", headers=headers)
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

count = 0
for building in buildings:
    count += 1
    print("Fetching listing %s/%s - %s" % (count, len(buildings), building))

    original_url = "https://programme.openhouse.org.uk/listings/%s" % building["id"]
    response = requests.get(original_url, cookies=cookies, headers=headers)
    if response.content == b"Retry later\n":
        print("Hit rate limiting, cannot continue")
        raise Exception("Rate limited")

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
    }

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

    # Images are fetched and stored by https://github.com/Jonty/open-house-london-images
    for image in data["images"]:
        image["archive_url"] = None
        # For some baffling reason some of the images refer to a broken relative path
        if image["url"].startswith("http"):
            image["archive_url"] = (
                "https://raw.githubusercontent.com/Jonty/open-house-london-images/master/images/%s/%s/%s"
                % (year, building["id"], os.path.basename(image["url"]))
            )

    # Address + location
    address_nodes = root.xpath('//p[contains(@class, "address")]/text()')
    data["location"]["address"] = address_nodes[0].strip()

    map_link = root.xpath('//a[@class="map-link"]')[0]
    data["location"]["latitude"] = float(map_link.attrib["data-lat"])
    data["location"]["longitude"] = float(map_link.attrib["data-lon"])

    travel_and_facilities_prefix = (
        '//section[contains(@class, "oc-listing-details")]/div[2]'
    )

    # Travel info
    travel_titles = root.xpath(travel_and_facilities_prefix + "/h4")
    travel_ps = root.xpath(travel_and_facilities_prefix + "/p")
    for node in zip(travel_titles, travel_ps):
        data["location"]["travel_info"].append(
            "%s: %s" % (node[0].text_content(), node[1].text_content())
        )

    # Facilities
    for node in root.xpath(travel_and_facilities_prefix + "/ul/li"):
        data["facilities"].append(node.text_content())

    # Short description
    description_nodes = root.xpath('//p[contains(@class, "summary")]')
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
        t
        for t in design_types.split(",")
        if (t not in architects) and (t.lower() not in data["design"]["types"])
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

    # External links (mostly websites and ticketing)
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

                if "eventbrite" in href:
                    links_ticketed = True

    # Events, oh no
    events_ticketed = False

    # Drop in events
    drop_in_node = root.xpath(
        '//section[contains(@class, "oc-listing-events")]//h2[text()="Drop in details"]'
    )
    if drop_in_node:
        date_nodes = drop_in_node[0].xpath(".//following-sibling::h3")
        events_nodes = drop_in_node[0].xpath(
            './/following-sibling::div[contains(@class, "events")]'
        )
        for date_node, event_node in zip(date_nodes, events_nodes):
            date_string = date_node.text_content().strip()
            date = parser.parse(date_string).date()

            for event in event_node.xpath('.//div[@class="event"]'):
                name = "Drop in"

                capacity = None
                capacity_node = event.xpath('.//p[contains(@class, "capacity")]/text()')
                if capacity_node:
                    matches = re.search("(\d+)", capacity_node[0])
                    capacity = int(matches.group(1))

                notes = event.xpath(".//p[not(@*)]")[0].text_content()
                time_string = event.xpath(".//h3/text()")[0]

                all_day = False
                if time_string == "All day":
                    all_day = True
                    # To make using the data easier, fake out the times
                    start_time = "00:00"
                    end_time = "23:59"
                else:
                    start_time, end_time = time_string.split(" to ")

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
                    }
                )

    # Not drop-in events
    events_node = root.xpath(
        '//section[contains(@class, "oc-listing-events")]//h2[text()="Events"]'
    )
    if events_node:
        events_ticketed = True

        date_nodes = events_node[0].xpath(".//following-sibling::h3")
        events_nodes = events_node[0].xpath(
            './/following-sibling::div[contains(@class, "events")]'
        )
        for date_node, event_node in zip(date_nodes, events_nodes):
            date_string = date_node.text_content().strip()
            date = parser.parse(date_string).date()

            for event in event_node.xpath('.//div[@class="event"]'):
                activity_type = event.xpath(
                    './/p[contains(@class, "activity-type")]/text()'
                )[0]
                time_string = event.xpath('.//p[@class="time"]/text()')[0]
                name = event.xpath('.//h3[@class="name"]/text()')[0]
                booking_string = (
                    event.xpath('.//div[@class="action"]')[0].text_content().strip()
                )

                fully_booked = False
                if booking_string == "Full":
                    fully_booked = True

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
                        "activity_type": activity_type,
                        "name": name,
                        "capacity": None,
                        "notes": None,  # No longer used, here for backward compat
                        "fully_booked": fully_booked,
                        "ticketed": True,
                        "booking_link": original_url,
                        "drop_in": False,
                    }
                )

    if links_ticketed or events_ticketed:
        data["ticketed_events"] = True

    os.makedirs("data/%s" % year, exist_ok=True)
    with open("data/%s/%s.json" % (year, data["id"]), "w", encoding="utf8") as f:
        f.write(
            json.dumps(
                data,
                indent=4,
                sort_keys=True,
                separators=(",", ": "),
                ensure_ascii=False,
            )
        )

    # 4s appears to avoid the rate limiting, but let's give ourselves some headroom
    time.sleep(4)
