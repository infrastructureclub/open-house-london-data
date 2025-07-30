import os
import glob
import json
import html
from collections import defaultdict
from datetime import datetime

year = datetime.now().year
input_directory = f"data/{year}"

output_directory = f"reports/balloted_venues/"
os.makedirs(output_directory, exist_ok=True)

if os.path.isdir(input_directory):

    groups = defaultdict(list)
    for filename in glob.glob(input_directory + "/*.json"):
        with open(filename, "r") as f:
            data = json.load(f)
            for event in data["events"]:
                if event["balloted"]:
                    groups[", ".join(data["design"]["types"])].append(data)
                    break

    with open(f"{output_directory}/{year}.html", "w") as of:

        of.write(
            f"""
            <html>
            <head>
                <meta charset='utf-8'/>
                <title>Balloted venues for London Open House {year}</title>
                <style type="text/css">
                    body {{
                        font-family: Helvetica, Bitstream Vera Sans, sans-serif;
                        color: #000000;
                        line-height: 1.5;
                        margin-top: 5%;
                        margin-left: 5%;
                    }}
                    h2 {{
                        border-bottom: 1px dashed;
                        border-color: green;
                    }}
                    .postcode {{
                        color: gray;
                        font-size: 0.8em;
                    }}
                </style>
            </head>
            <body>
            <h1>Balloted venues for London Open House {year}</h1>
        """
        )

        for types, listings in sorted(groups.items()):
            if types == "":
                types = "unknown"

            of.write(f"<h2>{types.title()}</h2>")
            for data in listings:
                description = html.escape(data["description"], quote=True)
                postcode = data["location"]["address"].split(",")[-1]
                of.write(
                    f"<li><a href='{data['original_url']}' title='{description}'>{data['name']}</a>&nbsp;<span class='postcode'>{postcode}</p></li>"
                )

        of.write(
            f"""
            </body>
            </html>
        """
        )

else:
    print(f"{directory} does not exist")
