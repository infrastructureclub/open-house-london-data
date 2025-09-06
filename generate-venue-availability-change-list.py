import os
import glob
import json
import html
from collections import defaultdict
from datetime import datetime, timezone

from dateutil import parser
from feedgen.feed import FeedGenerator


year = os.environ["YEAR"]
input_directory = f"scrape_summaries/{year}"

output_directory = f"scrape_summaries/"
os.makedirs(output_directory, exist_ok=True)

if os.path.isdir(input_directory):

    fg = FeedGenerator()
    fg.id("https://openhouse.infrastructureclub.org/scrape_summaries/2025.html")
    fg.title("London Open House venue availability changes")
    fg.author({"name": "Infrastructure Club"})
    fg.subtitle("London Open House venue availability changes")
    fg.link(
        href="https://github.com/infrastructureclub/open-house-london-data",
        rel="alternate",
    )
    fg.language("en")

    with open(f"{output_directory}/{year}.html", "w") as of:
        of.write(
            f"""
            <html>
            <head>
                <meta charset='utf-8'/>
                <title>London Open House venue availability changes for {year}</title>
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
                <link rel="alternate" type="application/rss+xml" title="Open House venue availability changes feed" href="https://openhouse.infrastructureclub.org/scrape_summaries/rss.xml" />
            </head>
            <body>
            <h1>London Open House venue availability changes for {year}&nbsp;<a href="rss.xml"><img src="../../assets/rss.png"></a></h1>
        """
        )

        def render_venue(fh, venue_id, trailer=""):
            with open(f"data/{year}/{venue_id}.json", "r") as f:
                data = json.load(f)

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

            fh.write(
                f"<li>{new}<a href='{data['original_url']}' title='{description}'>{data['name']}</a>{ticket}&nbsp;<span class='trailer'>{', '.join(data['design']['types'])}&nbsp;|&nbsp;{postcode}{trailer}</span></li>\n"
            )

            return data

        generated_date = None

        files = sorted(glob.glob(input_directory + "/*.json"))
        files.reverse()
        for filepath in files[:24]:
            with open(filepath, "r") as f:
                data = json.load(f)

            if not data["venues_now_bookable"] and not data["venues_added_days"]:
                continue

            filename = filepath.split("/")[-1]
            date = datetime.strptime(filename, f"%Y-%m-%d_%H%M.json")
            date = date.replace(tzinfo=timezone.utc)

            if not generated_date:
                generated_date = date

            of.write(f"<h2 id='{filename}'>{date:%a %d %B at %H:%M}</h2>\n")

            summaries = []
            summary_bodies = []

            if data["venues_now_bookable"]:
                of.write(f"<h4>Tickets released</h4>\n")
                of.write("<ul>\n")
                for venue_id in data["venues_now_bookable"]:
                    venue_data = render_venue(of, venue_id)
                    summary_bodies.append(
                        f"🎟️ {venue_data['id']} - {venue_data['name']}<br>"
                    )
                of.write("</ul>\n")

                summaries.append(
                    f'Tickets released for {len(data["venues_now_bookable"])} venues'
                )

            if data["venues_added_days"]:
                of.write(f"<h4>Dates added</h4>\n")
                of.write("<ul>\n")
                for venue_id, dates in data["venues_added_days"].items():
                    venue_data = render_venue(
                        of, venue_id, f" - New dates: {', '.join(dates)}"
                    )
                    summary_bodies.append(
                        f"🗓️ {venue_data['id']} - {venue_data['name']}<br>"
                    )
                of.write("</ul>\n")

                summaries.append(f'{len(data["venues_added_days"])} venues added dates')

            fe = fg.add_entry()
            fe.id(filename)
            fe.published(published=date)
            fe.updated(updated=date)
            fe.title(f'{", ".join(summaries)} on {date:%a %d %B at %H:%M}')
            fe.description("\n".join(summary_bodies))
            fe.link(
                href=f"https://openhouse.infrastructureclub.org/scrape_summaries/{year}.html#{filename}"
            )

        of.write(
            f"""
            </body>
            </html>
        """
        )

        fg.updated(generated_date)
        fg.atom_file(f"{output_directory}/atom.xml", pretty=True)
        fg.rss_file(f"{output_directory}/rss.xml", pretty=True)

else:
    print(f"{directory} does not exist")
