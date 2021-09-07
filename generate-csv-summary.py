#!/usr/bin/python
import os
import json
import csv
from collections import defaultdict

year = 2021
data_path = 'data/%s' % year
csv_path = 'csv/%s' % year

dates = defaultdict(list)

for filename in os.listdir(data_path):
    if '.json' not in filename:
        continue

    with open(data_path + '/' + filename, 'r') as f:
        data = json.load(f)

    for event in data["events"]:
        dates[event["date"]].append(data)

    if data["all_week"]:
        dates["all_week"].append(data)

header = ['name', 'url', 'description', 'address', 'latitude', 'longitude', 'ticketed_events', 'fully_booked']

for date, locations in dates.items():
    os.makedirs(csv_path, exist_ok=True)

    print("Writing %s..." % date)

    with open(csv_path + '/' + date + '.csv', 'w', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(header)

        for location in locations:
            fully_booked = True

            # Choose the most open state
            # If any events are None it means we can't determine booking status
            if location['ticketed_events']:
                for event in location['events']:
                    if fully_booked != None:
                        if event['fully_booked'] == False:
                            fully_booked = False
                        if event['fully_booked'] == None:
                            fully_booked = "Unknown"
            else:
                fully_booked = False

            writer.writerow([
                location['name'],
                location['original_url'],
                location['description'],
                location['location']['address'],
                location['location']['latitude'],
                location['location']['longitude'],
                location['ticketed_events'],
                fully_booked,
            ])
