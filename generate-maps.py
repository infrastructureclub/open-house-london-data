#!/usr/bin/python
import os
import json
import csv
from collections import defaultdict

import simplekml
from shapely.geometry import mapping
from shapely.geometry import Point

year = 2021
data_path = 'data/%s' % year
maps_path = 'maps/%s' % year

def make_maps(lon, lat, location_name):
    """ create a Point and convert it into a dict suitable for GeoJSON output"""


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


for date, locations in dates.items():
    os.makedirs(maps_path, exist_ok=True)

    print("Writing %s..." % date)

    kml = simplekml.Kml()
    features = []

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

        lat = location["location"]["latitude"]
        lon = location["location"]["longitude"]

        kml.newpoint(
            name=location["name"],
            coords=[(lon, lat)],
        )

        p = mapping(Point(float(lon), float(lat)))
        features.append({
            "type": "Feature",
            "properties": {
                "name": location["name"],
                "url": location["original_url"],
                "ticketed_events": location["ticketed_events"],
                "fully_booked": fully_booked,
            }, 
            "geometry": p
        })

    schema = {
        "type": "FeatureCollection",
        "features": features,
    }

    with open(maps_path + '/' + date + '.geojson', 'w', encoding='utf-8') as f:
        f.write(json.dumps(schema))

    kml.save(maps_path + '/' + date + '.kml')
