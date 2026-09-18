import os
import glob
import json
import html
from datetime import datetime, timezone

from feedgen.feed import FeedGenerator
import pytz

london_tz = pytz.timezone("Europe/London")

year = os.environ["YEAR"]
input_directory = f"scrape_summaries/{year}"

output_directory = f"reports/withdrawn_venues/"
os.makedirs(output_directory, exist_ok=True)

reason_labels = {
    "withdrawn": "withdrawn by venue",
    "deleted": "listing deleted",
    "unpublished": "listing unpublished",
    "unlisted": "removed",
}

if os.path.isdir(input_directory):

    fg = FeedGenerator()
    fg.id(f"https://openhouse.infrastructureclub.org/reports/withdrawn_venues/{year}.html")
    fg.title("London Open House withdrawn venues")
    fg.author({"name": "Infrastructure Club"})
    fg.subtitle("London Open House withdrawn venue feed")
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
                <title>London Open House withdrawn venues for {year}</title>
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
                <link rel="alternate" type="application/rss+xml" title="Open House withdrawn venue feed" href="https://openhouse.infrastructureclub.org/reports/withdrawn_venues/rss.xml" />
            </head>
            <body>
            <h1>London Open House withdrawn venues for {year}&nbsp;<a href="rss.xml"><img src="../../assets/rss.png"></a></h1>
            <p>Venues that were listed for Open House {year} and have since been withdrawn or removed. ↩️ marks venues that have since been listed again.</p>
        """
        )

        latest_date = None

        files = sorted(glob.glob(input_directory + "/*.json"), reverse=True)
        for filepath in files:
            with open(filepath, "r") as f:
                summary = json.load(f)

            # Older summaries only recorded IDs, and a failed scrape can log
            # venues as removed without them ever leaving the repo, so only
            # report venues we have details for
            removed = summary.get("removed_venue_details", {})
            if not removed:
                continue

            filename = filepath.split("/")[-1]
            date = datetime.strptime(filename, "%Y-%m-%d_%H%M.json")
            date = date.replace(tzinfo=timezone.utc)
            date = date.astimezone(london_tz)

            if not latest_date:
                latest_date = date

            of.write(f"<h2 id='{filename}'>{date:%a %d %B at %H:%M}</h2>\n")
            of.write("<ul>\n")

            summary_bodies = []
            for venue_id, data in sorted(
                removed.items(), key=lambda v: (v[1]["name"], v[0])
            ):
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

                relisted = ""
                if os.path.exists(f"data/{year}/{venue_id}.json"):
                    relisted = "&nbsp;↩️"

                reason = reason_labels.get(data.get("removal_reason"), "")
                if reason:
                    reason = f"&nbsp;|&nbsp;{reason}"

                of.write(
                    f"<li>{new}<a href='{data['original_url']}' title='{description}'>{data['name']}</a>{ticket}{relisted}&nbsp;<span class='trailer'>{', '.join(data['design']['types'])}&nbsp;|&nbsp;{postcode}{reason}</span></li>\n"
                )
                summary_bodies.append(f"❌ {venue_id} - {data['name']}<br>")

            of.write("</ul>\n")

            fe = fg.add_entry()
            fe.id(filename)
            fe.published(published=date)
            fe.updated(updated=date)
            fe.title(
                f"{len(removed)} Open House venue{'s' if len(removed) != 1 else ''} withdrawn on {date:%a %d %B at %H:%M}"
            )
            fe.description("\n".join(summary_bodies))
            fe.link(
                href=f"https://openhouse.infrastructureclub.org/reports/withdrawn_venues/{year}.html#{filename}"
            )

        of.write(
            f"""
            </body>
            </html>
        """
        )

        fg.updated(latest_date)
        fg.atom_file(f"{output_directory}/atom.xml", pretty=True)
        fg.rss_file(f"{output_directory}/rss.xml", pretty=True)

else:
    print(f"{input_directory} does not exist")
