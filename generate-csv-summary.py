#!/usr/bin/python
import os
import json
import csv
from collections import defaultdict
from datetime import datetime

from dateutil import parser
import pytz

year = os.environ["YEAR"]
timezone = pytz.timezone("Europe/London")
data_path = "data/%s" % year
csv_path = "csv/%s" % year

dates = defaultdict(list)

for filename in os.listdir(data_path):
    if ".json" not in filename:
        continue

    with open(data_path + "/" + filename, "r") as f:
        data = json.load(f)

    for date in set(event["date"] for event in data["events"]):
        dates[date].append(data)

    if data["all_week"]:
        dates["all_week"].append(data)

header = [
    "name",
    "url",
    "description",
    "address",
    "latitude",
    "longitude",
    "start_time",
    "end_time",
    "ticketed_events",
    "fully_booked",
]

now = timezone.localize(datetime.now())

for date, locations in dates.items():
    os.makedirs(csv_path, exist_ok=True)

    print("Writing %s..." % date)

    with open(csv_path + "/" + date + ".csv", "w", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)

        for location in sorted(locations, key=lambda x: x["name"]):
            fully_booked = "Yes"
            start = None
            end = None

            # Choose the most open state
            # If any events are None it means we can't determine booking status
            if not location["events"]:
                # No events, this must be an all_week thing
                fully_booked = "Unknown"

            else:
                for event in location["events"]:
                    if event["date"] == date:
                        # Open/close time
                        event_start = parser.parse(event["start"])
                        if not start or event_start < start:
                            start = event_start

                        event_end = parser.parse(event["end"])
                        if not end or event_end > end:
                            end = event_end

                        # Ticket status
                        if location["ticketed_events"]:
                            if fully_booked != "Unknown":
                                # If an event is in the past we discard it for figuring
                                # out fully_booked status, as it no longer matters and
                                # it defaults to false on the OH website after the
                                # event is over. This is a hack and we should do it
                                # differently.
                                if event["fully_booked"] == False and event_start > now:
                                    fully_booked = "No"
                                if event["fully_booked"] == None:
                                    fully_booked = "Unknown"
                        else:
                            fully_booked = ""

                    if event["balloted"]:
                        balloted_events = True

            start_time = None
            end_time = None
            if start and end:
                start_time = start.time().isoformat()
                end_time = end.time().isoformat()

            writer.writerow(
                [
                    location["name"],
                    location["original_url"],
                    location["description"],
                    location["location"]["address"],
                    location["location"]["latitude"],
                    location["location"]["longitude"],
                    start_time,
                    end_time,
                    "Yes" if location["ticketed_events"] else "No",
                    fully_booked,
                ]
            )
