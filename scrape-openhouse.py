#!/usr/bin/python
import os
import sys
import json

import requests
import lxml.html
from dateutil import parser
import pytz

year = 2021
timezone = pytz.timezone("Europe/London")

response = requests.get("https://openhouselondon.open-city.org.uk/")
root = lxml.html.document_fromstring(response.content)

map_nodes = root.xpath('//div[contains(@class, "map")]')
buildings = json.loads(map_nodes[0].attrib["data-buildings"])

count = 0
for building in buildings:
    count += 1
    print("Fetching %s/%s - %s" % (count, len(buildings), building))

    original_url = "https://openhouselondon.open-city.org.uk/listings/%s" % building["id"]
    response = requests.get(original_url)
    root = lxml.html.document_fromstring(response.content)

    data = {
        "id": building["id"],
        "original_url": original_url,
        "name": building["name"],
        "location": {
            "latitude": building["latitude"],
            "longitude": building["longitude"],
            "address": None,
            "travel_info": [],
            "meeting_point": None,
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
        "all_week": False,
        "ticketed_events": False,
    }

    # Images
    image_nodes = root.xpath('//ul[contains(@class, "main-image")]')
    if image_nodes:
        for image in json.loads(image_nodes[0].attrib["data-full_size_photos"]):
            title, description = image["subHtml"][4:-4].split("</h4><p>")
            data["images"].append(
                {
                    "url": image["src"],
                    "title": title,
                    "description": description,
                }
            )
    else:
        # Oh why not just have a totally different rendering for images when you only have one, of course
        image_nodes = root.xpath('//div[contains(@class, "main-image")]/img')
        if image_nodes:
            data["images"].append(
                {
                    "url": image_nodes[0].attrib["src"],
                    "title": image_nodes[0].attrib["alt"],
                    "description": None,
                }
            )

    # Address
    address_nodes = root.xpath('//div[contains(@class, "address")]/div')
    data["location"]["address"] = address_nodes[0].text_content().strip()

    # Travel info
    for node in root.xpath('//div[contains(@class, "travel-info")]/div'):
        data["location"]["travel_info"].append(node.text_content().strip())

    # Meeting point
    meeting_nodes = root.xpath('//div[contains(@class, "meeting-point")]/div')
    if meeting_nodes:
        data["location"]["meeting_point"] = (
            meeting_nodes[0].text_content().replace("Meet at:", "").strip()
        )

    # Facilities
    for node in root.xpath('//div[contains(@class, "facilities")]/div'):
        data["facilities"].append(node.text_content().strip().split(", "))

    # External links (mostly websites and ticketing)
    links_ticketed = False
    for link in root.xpath('//div[contains(@class, "external-links")]//a'):
        href = link.attrib["href"]
        title = link.text_content().strip()
        data["links"].append(
            {
                "href": href,
                "title": title,
            }
        )

        for keyword in ("book", "ballot", "ticket"):
            if keyword in title.lower():
                links_ticketed = True

        if "eventbrite" in href:
            links_ticketed = True

    # Short description
    description_nodes = root.xpath('//div[contains(@class, "description")]')
    data["description"] = description_nodes[0].text_content().strip()

    # Design notes + tags
    design_nodes = root.xpath('//dl[contains(@class, "designs")]')
    for description, section in zip(
        design_nodes[0].xpath(".//dt"), design_nodes[0].xpath(".//dd")
    ):
        architect = (
            section.xpath(".//span[contains(@class, 'designers')]")[0]
            .text_content()
            .strip()[:-1]
        )
        design_year = (
            section.xpath(".//span[contains(@class, 'year')]")[0].text_content().strip()
        )

        data["design"]["designers"].append(
            {
                "description": description.text_content().strip(),
                "architect": architect,
                "year": design_year,
            }
        )

    for node in root.xpath('//dl[contains(@class, "tags")]//dd'):
        data["design"][node.attrib["class"]] = node.text_content().strip().split(", ")

    # Big free text section at the bottom, they call it the factsheet
    for section in root.xpath('//li[contains(@class, "section")]'):
        data["factsheet"].append(
            {
                "heading": section.xpath(".//h3")[0].text_content().strip(),
                "paragraphs": [p.text_content().strip() for p in section.xpath(".//p")],
            }
        )

    # Events, oh no
    events_ticketed = False

    events_nodes = root.xpath('//div[contains(@class, "listing-events")]')
    if not events_nodes:
        data["all_week"] = True
    else:
        for date_node, events_node in zip(events_nodes[0].xpath(".//dt"), events_nodes[0].xpath(".//dd")):
            for event_node in events_node.xpath(".//div[@class='event']"):

                name = (
                    event_node.xpath(".//div[contains(@class, 'event-name')]")[0]
                    .text_content()
                    .strip()
                )

                # They removed all the nice event-time/event-capacity/event-note
                # classes and merged them all into the same class :'(
                detail_nodes = event_node.xpath(".//div[contains(@class, 'event-detail')]/i")
                time_node = detail_nodes.pop(0)
                timeslot = time_node.tail.replace("Time:", "").strip()
                if "All-day" in timeslot:
                    start_time = "00:00"
                    end_time = "23:59"
                    all_day = True
                else:
                    start_time, end_time = timeslot.replace(".", ":").split(" to ")
                    all_day = False

                capacity = None
                if detail_nodes:
                    capacity = int(detail_nodes[0].tail.replace("Capacity:", "").strip())

                details_nodes = event_node.xpath(".//div[contains(@class, 'event-details')]")
                notes = None
                if len(details_nodes) == 2:
                    notes = details_nodes[1].text_content().strip()

                date = parser.parse(date_node.text_content()).date()
                start_datetime = parser.parse(date_node.text_content() + " " + start_time)
                start_datetime = timezone.localize(start_datetime)
                end_datetime = parser.parse(date_node.text_content() + " " + end_time)
                end_datetime = timezone.localize(end_datetime)

                keyword_ticketed = False
                button_ticketed = False
                fully_booked = None
                booking_link = None

                if notes:
                    if "book" in notes.lower():
                        keyword_ticketed = True

                        phrases = (
                            "no book",
                            "booking not",
                            "no need to book",
                            "new book",
                            "sketchbook",
                            "buy our book",
                            "booking is not required",
                        )
                        for phrase in phrases:
                            if phrase in notes.lower():
                                keyword_ticketed = False

                    if "ticket" in notes.lower():
                        keyword_ticketed = True

                        for phrase in ("tickets not needed", "unticketed"):
                            if phrase in notes.lower():
                                keyword_ticketed = False

                    if "eventbrite" in notes.lower():
                        keyword_ticketed = True

                    if "ballot" in notes.lower():
                        keyword_ticketed = True

                booking_button = event_node.xpath(
                    ".//*[contains(@class, 'event-booking-button')]"
                )
                if booking_button:
                    button_ticketed = True
                    if "disabled" in booking_button[0].attrib:
                        fully_booked = True
                    if "href" in booking_button[0].attrib:
                        fully_booked = False
                        booking_link = (
                            "https://openhouselondon.open-city.org.uk%s"
                            % booking_button[0].attrib["href"]
                        )

                ticketed = keyword_ticketed or button_ticketed

                data["events"].append(
                    {
                        "date": date.isoformat(),
                        "start": start_datetime.isoformat(),
                        "end": end_datetime.isoformat(),
                        "all_day": all_day,
                        "name": name,
                        "capacity": capacity,
                        "notes": notes,
                        "fully_booked": fully_booked,
                        "ticketed": ticketed,
                        "booking_link": booking_link,
                    }
                )

                if ticketed:
                    events_ticketed = True

    if links_ticketed or events_ticketed:
        data["ticketed_events"] = True

    os.makedirs("data/%s" % year, exist_ok=True)
    with open("data/%s/%s.json" % (year, data["id"]), "w", encoding='utf8') as f:
        f.write(json.dumps(data, indent=4, sort_keys=True, separators=(",", ": "), ensure_ascii=False))
