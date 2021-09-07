#!/usr/bin/python
import os
import json
import csv
from collections import defaultdict

import simplekml
from shapely.geometry import mapping
from shapely.geometry import Point

year = 2021
data_path = "data/%s" % year
maps_path = "maps/%s" % year


def make_maps(lon, lat, location_name):
    """ create a Point and convert it into a dict suitable for GeoJSON output"""


dates = defaultdict(list)

for filename in os.listdir(data_path):
    if ".json" not in filename:
        continue

    with open(data_path + "/" + filename, "r") as f:
        data = json.load(f)

    for event in data["events"]:
        dates[event["date"]].append(data)

    if data["all_week"]:
        dates["all_week"].append(data)


for date, locations in dates.items():
    print("Writing %s..." % date)

    kml = simplekml.Kml()
    features = []

    for location in sorted(locations, key=lambda l: l['id']):
        fully_booked = "Yes"

        # Choose the most open state
        # If any events are None it means we can't determine booking status
        if location["ticketed_events"]:
            for event in location["events"]:
                if event["date"] == date:
                    if fully_booked != "Unknown":
                        if event["fully_booked"] == False:
                            fully_booked = "No"
                        if event["fully_booked"] == None:
                            fully_booked = "Unknown"
        else:
            fully_booked = ""

        lat = location["location"]["latitude"]
        lon = location["location"]["longitude"]

        kml.newpoint(
            name=location["name"],
            coords=[(lon, lat)],
        )

        p = mapping(Point(float(lon), float(lat)))
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": "<b><a href='%s'>%s</a></b>"
                    % (location["original_url"], location["name"]),
                    "ticketed_events": "Yes" if location["ticketed_events"] else "No",
                    "fully_booked": fully_booked,
                },
                "geometry": p,
            }
        )

    schema = {
        "type": "FeatureCollection",
        "features": features,
    }

    os.makedirs(maps_path + "/geojson", exist_ok=True)
    with open(maps_path + "/geojson/" + date + ".geojson", "w", encoding="utf-8") as f:
        f.write(json.dumps(schema))

    os.makedirs(maps_path + "/kml", exist_ok=True)
    kml.save(maps_path + "/kml/" + date + ".kml")
