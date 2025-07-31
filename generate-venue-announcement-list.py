import os
import glob
import json
import html
from collections import defaultdict
from datetime import datetime, timezone

from dateutil import parser
from feedgen.feed import FeedGenerator


year = os.environ["YEAR"]
input_directory = f"data/{year}"

output_directory = f"reports/venues_announced/"
os.makedirs(output_directory, exist_ok=True)

if os.path.isdir(input_directory):

    fg = FeedGenerator()
    fg.id('http://lernfunk.de/media/654321')
    fg.title('London Open House venue announcements')
    fg.author( {'name':'Infrastructure Club'} )
    fg.subtitle('London Open House venue announcement feed')
    fg.link( href='https://github.com/infrastructureclub/open-house-london-data', rel='alternate' )
    fg.language('en')

    groups = defaultdict(list)
    for filename in glob.glob(input_directory + "/*.json"):
        with open(filename, "r") as f:
            data = json.load(f)
            groups[data["first_published"]].append(data)

    with open(f"{output_directory}/{year}.html", "w") as of:

        of.write(
            f"""
            <html>
            <head>
                <meta charset='utf-8'/>
                <title>London Open House venue announcements for {year}</title>
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
                    .trailer {{
                        color: gray;
                        font-size: 0.8em;
                    }}
                </style>
                <link rel="alternate" type="application/rss+xml" title="Open House venue announcement feed" href="https://openhouse.infrastructureclub.org/reports/venues_announced/rss.xml" />
            </head>
            <body>
            <h1>London Open House venue announcements for {year}&nbsp;<a href="rss.xml"><img src="../../assets/rss.png"></a></h1>
        """
        )

        for datestring, listings in sorted(groups.items(), reverse=True):
            date = parser.parse(datestring)
            date = date.replace(tzinfo=timezone.utc)

            of.write(f"<h2 id='{datestring}'>{date:%a %d %B at %H:%M}</h2>\n")
            for data in listings:
                description = html.escape(data["description"], quote=True)
                postcode = data["location"]["address"].split(",")[-1]

                ticket = ""
                if data["balloted_events"]:
                    ticket = "&nbsp;🗳️"
                elif data["ticketed_events"]:
                    ticket = "&nbsp;🎟️"

                new = ""
                if data["new_venue_this_year"]:
                    new = "🆕&nbsp;"

                of.write(
                    f"<li>{new}<a href='{data['original_url']}' title='{description}'>{data['name']}</a>{ticket}&nbsp;<span class='trailer'>{', '.join(data['design']['types'])}&nbsp;|&nbsp;{postcode}</span></li>\n"
                )

            fe = fg.add_entry()
            fe.id(datestring)
            fe.published(published=date)
            fe.title(f'{len(listings)} new Open House venues listed on {date:%a %d %B at %H:%M}')
            fe.link(href=f'https://openhouse.infrastructureclub.org/reports/venues_announced/{year}.html#{datestring}')

        of.write(
            f"""
            </body>
            </html>
        """
        )

        fg.atom_file(f'{output_directory}/atom.xml', pretty=True)
        fg.rss_file(f'{output_directory}/rss.xml', pretty=True)

else:
    print(f"{directory} does not exist")
