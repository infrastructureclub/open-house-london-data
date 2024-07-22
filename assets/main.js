"use strict";

(async () => {
  const formatTimePart = (n) => `${String(Math.floor(n)).padStart(2, '0')}`;
  const formatTime = (t) => `${formatTimePart(t)}:${formatTimePart((t % 1) * 60)}`;
  const strcmp = (a, b) => (a > b) - (a < b);

  const hash = new URLSearchParams(document.location.hash.substr(1));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  const hashYear = hash.get('year');
  const year = (hashYear == null) ? currentYear : Number(hashYear);

  const domContentLoaded = new Promise((resolve, reject) => {
    if (document.readyState !== 'loading') resolve();
    document.addEventListener('DOMContentLoaded', resolve);
  });

  const windowReady = new Promise((resolve, reject) => {
    if (document.readyState == 'complete') resolve();
    window.addEventListener('load', resolve);
  });

  const fetchDate = async (datestr) => {
    const resp = await fetch(`maps/${year}/geojson/${datestr}.geojson`);
    return await resp.json();
  };
  const getListings = async () => {
    const date = document.forms.filter.date.value;
    if (date != 'all') return await fetchDate(date);

    const listings = {
        'features': [],
        'type': 'FeatureCollection',
    };
    const jsons = await Promise.all(listingDates.map(d => fetchDate(d)));
    const ids = {};
    for (const json of jsons) {
      for (const feature of json.features) {
        const id = Number(feature.properties.url.split(/\//).pop());
        if (id in ids) continue;
        ids[id] = feature;
        listings.features.push(feature);
      }
    }
    return listings;
  };

  const matchesSearch = (feature, search) => {
    /* Pull out unquoted terms separated by whitespace or inside matched quotes */
    const terms = search.toLowerCase().match(/(?:[^\s"]+|"[^"]*")+/g)
    const unquoted = terms.map(t => t.replace(/^"(.*)"$/, '$1'));
    /* No need to strip empty terms as ''.includes('') */
    return unquoted.every(t =>
      feature.properties.description.toLowerCase().includes(t) ||
      feature.properties.name.toLowerCase().includes(t)
    );
  };

  const updateProperties = (listings) => {
    for (const feature of listings.features) {
      const props = feature.properties;
      props.match = false;
      props.state = '';
      props.icon = 'marker-red';
      const search = document.forms.filter.search.value;
      if (search) {
        props.match = matchesSearch(feature, search);
      }
      const id = Number(props.url.split(/\//).pop());
      const dates = favourites[id];
      if (!dates) continue;
      const anyBookmarked = Object.values(dates).some(f => f.state == 'bookmarked');
      const currentBookmarked = dates?.[document.forms.filter.date.value]?.state;
      if (currentBookmarked == 'bookmarked' || (document.forms.filter.date.value == 'all' && anyBookmarked)) {
        props.state = 'bookmarked';
        props.icon = 'marker-green';
      } else if (anyBookmarked) {
        props.state = 'bookmarked-elsewhere';
        props.icon = 'marker-yellow';
      }
    }
  }

  const getListingsFilter = () => {
    const filter = ['all', ['literal', true]];
    if (document.forms.filter.search.value) {
      filter.push(['get', 'match']);
    }
    switch (document.forms.filter.new_venue_this_year.value) {
      case 'yes': filter.push(['==', ['get', 'new_venue_this_year'], 'Yes']); break;
      case 'no': filter.push(['==', ['get', 'new_venue_this_year'], 'No']); break;
    }
    switch (document.forms.filter.ticketed_events.value) {
      case 'yes': filter.push(['==', ['get', 'ticketed_events'], 'Yes']); break;
      case 'no': filter.push(['==', ['get', 'ticketed_events'], 'No']); break;
    }
    switch (document.forms.filter.fully_booked.value) {
      case 'yes': filter.push(['in', ['get', 'fully_booked'], ['literal', ['Yes', 'Unknown']]]); break;
      /* If ticketed_events is No, fully_booked will be "", which we want to
       * include here. If the ticketed_events filter is set to yes, we won't
       * see any ambiguous events anyway. */
      case 'no': filter.push(['in', ['get', 'fully_booked'], ['literal', ['No', 'Unknown', '']]]); break;
    }
    if (document.forms.filter.from_time.valueAsNumber > 0) {
      filter.push(['>', ['get', 'end'], ['literal', `${formatTime(document.forms.filter.from_time.valueAsNumber)}:00`]]);
    }
    if (document.forms.filter.to_time.valueAsNumber > 0) {
      filter.push(['<', ['get', 'start'], ['literal', `${formatTime(24 - document.forms.filter.to_time.valueAsNumber)}:00`]]);
    }
    /* Not redundant as we include events from other days */
    switch (document.forms.filter.bookmarked.value) {
      case 'yes': filter.push(['in', ['get', 'state'], ['literal', ['bookmarked', 'bookmarked-elsewhere']]]); break;
      case 'no': filter.push(['in', ['get', 'state'], ['literal', ['']]]); break;
    }
    return filter;
  };

  let currentListings;
  const updateListings = async () => {
    lastPopup?.remove();
    const map = await mapReady;
    console.log(`Updating listings`);
    currentListings = await getListings();
    updateProperties(currentListings);
    map.getSource('listings').setData(currentListings);
    map.getLayer('listings-bookmarked-markers').visibility = 'visible';
    map.getLayer('listings-bookmarked-labels').visibility = 'visible';
    map.getLayer('listings-other-markers').visibility = 'visible';
    map.getLayer('listings-other-labels').visibility = 'visible';

    console.log(`Updating filters`);
    const filter = getListingsFilter();
    const filterBookmarked = ['in', ['get', 'state'], ['literal', ['bookmarked']]];
    const filterOther = ['in', ['get', 'state'], ['literal', ['', 'bookmarked-elsewhere']]];
    map.setFilter('listings-bookmarked-labels', [...filter, filterBookmarked]);
    map.setFilter('listings-bookmarked-markers', [...filter, filterBookmarked]);
    map.setFilter('listings-other-labels', [...filter, filterOther]);
    map.setFilter('listings-other-markers', [...filter, filterOther]);
    saveFilter();
  };

  const saveFilter = () => {
    const hash = new URLSearchParams(document.location.hash.substr(1));
    const date = document.forms.filter.date.value;
    const new_venue_this_year = document.forms.filter.new_venue_this_year.value;
    const ticketed_events = document.forms.filter.ticketed_events.value;
    const fully_booked = document.forms.filter.fully_booked.value;
    const from_time = document.forms.filter.from_time.valueAsNumber;
    const to_time = 24 - document.forms.filter.to_time.valueAsNumber;
    hash.set('filter', `${date}/${from_time}/${to_time}/${new_venue_this_year}/${ticketed_events}/${fully_booked}`);
    hash.set('search', document.forms.filter.search.value);
    if (!hash.get('search')) hash.delete('search');
    document.location.hash = '#' + hash.toString().replaceAll('%2F', '/');
  };

  const loadFilter = () => {
    const hash = new URLSearchParams(document.location.hash.substr(1));
    const search = hash.get('search');
    document.forms.filter.search.value = search;
    const filter = hash.get('filter');
    if (!filter) return;
    const [date, from_time, to_time, new_venue_this_year, ticketed_events, fully_booked] = filter.split('/');
    /* These assignments will be ignored if the values are invalid */
    document.forms.filter.date.value = date;
    document.forms.filter.from_time.valueAsNumber = from_time;
    document.forms.filter.to_time.valueAsNumber = 24 - to_time;
    document.forms.filter.new_venue_this_year.value = new_venue_this_year;
    document.forms.filter.ticketed_events.value = ticketed_events;
    document.forms.filter.fully_booked.value = fully_booked;
    updateTimeFilter();
  };


  const buildPopupContent = (feature) => {
    const { name, description, url, images, new_venue_this_year, fully_booked, ticketed_events, start, end } = feature.properties;
    const id = Number(url.split(/\//).pop());
    const ticket_class = ticketed_events == 'Yes' ? 'ticketed' : '';
    const data = [
      `<dt>Ticketed</dt><dd class="${ticket_class}">${ticketed_events}</dd>`
    ];
    if (ticketed_events == 'Yes') {
      data.push(`<dt>Fully booked</dt><dd>${fully_booked}</dd>`);
    }
    if (start !== "null" && end !== "null") {
      const [startMin, endMin] = [start, end].map(t => t.substr(0, 5));
      if (startMin == "00:00" && endMin == "23:59") {
        data.push(`<dt>Time</dt><dd>All-day</dd>`);
      } else {
        data.push(`<dt>Starts</dt><dd>${startMin}</dd><dt>Finishes</dt><dd>${endMin}</dd>`);
      }
    }
    data.push(`<dt>New this year</dt><dd>${new_venue_this_year}</dd>`);
    const coords = feature.geometry.coordinates;
    const latlng = `${coords[1]},${coords[0]}`;
    const gmapsParams = new URLSearchParams({'api': 1, 'destination': latlng});
    const gmapsUrl = `https://www.google.com/maps/dir/?${gmapsParams}`;
    const cmParams = new URLSearchParams({'endcoord': latlng, 'endname': name});
    const date = document.forms.filter.date.value;
    const faveData = favourites[id]?.[date];
    const bookmarked = faveData?.state == 'bookmarked';
    const cmUrl = `https://citymapper.com/directions?${cmParams}`;
    const div = document.createElement('div');
    div.innerHTML = `
      <header>
        <label><input type="checkbox" class="bookmark"${bookmarked ? ' checked' : ''}/>Bookmark</label>
      </header>
      <img class="hero">
      <section>
        <a class="ohl-link" target="_blank"></a>
        <p class="description"></p>
        <p>
          <a class="gmaps-link" href="${gmapsUrl}" target="_blank">
            <img src="assets/googlemaps-icon-167px.png"/>
          </a>
          <a class="cm-link" href="${cmUrl}" target="_blank">
            <img src="assets/citymapper-logo-220px.png"/>
          </a>
        </p>
        <dl>${data.join('\n')}</dl>
      </section>
    `;
    div.querySelector('a.ohl-link').href = url;
    div.querySelector('a.ohl-link').innerText = name;
    // Argh, mapbox JSON-encodes object properties
    const actualImages = JSON.parse(images);
    if (actualImages.length) {
      const img = div.querySelector('img.hero')
      img.src = actualImages[0].archive_url;
      img.alt = actualImages[0].title;
      img.addEventListener('load', () => img.style.opacity = 1);
      setTimeout(() => { if (!img.complete){ img.style.transitionDuration = '1s' }}, 100);
      img.style.opacity = 0;
    } else {
      div.querySelector('img.hero').remove();
      div.classList.add('no-hero');
    }
    div.querySelector('.description').innerText = description;
    const bookmarkEl = div.querySelector('input');
    bookmarkEl.addEventListener('change', updateBookmark);
    bookmarkEl.dataset.name = name;
    bookmarkEl.dataset.url = url;
    return div;
  };

  const updateBookmark = (e) => {
    const name = e.target.dataset.name;
    const url = e.target.dataset.url;
    const id = Number(url.split(/\//).pop());
    const date = document.forms.filter.date.value;
    const state = e.target.checked ? 'bookmarked' : '';
    setFavourite(id, name, date, state);
    saveFavourites();
  }

  const fetchMarkers = () => {
    const markers = {
      'marker-red': 'assets/mapbox-marker-icon-48px-red.png',
      'marker-green': 'assets/mapbox-marker-icon-48px-green.png',
      'marker-yellow': 'assets/mapbox-marker-icon-48px-yellow.png',
    };
    const promises = [];
    for (const [name, url] of Object.entries(markers)) {
      const img = new Image();
      img.src = url;
      promises.push(img.decode().then(() => [name, img]));
    }
    return Promise.all(promises);
  };
  /* Set them downloading as early as possible */
  const markers = fetchMarkers();

  let lastPopup = null;
  const mapReady = new Promise(async (resolve, reject) => {
    /* Ensure CSS has been loaded */
    await windowReady;

    mapboxgl.accessToken = 'pk.eyJ1IjoibXM3ODIxIiwiYSI6ImNrdGFlMTMwMzA5dnYycG15MzhjeXgwa3MifQ.hD7yHtV4jWmf5tige7c2kg';

    console.log(`Creating map`);
    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/light-v10',
      hash: 'map',
      center: [-0.1, 51.52],  // approximately Smithfield
      zoom: 13,
    });

    map.addControl(new mapboxgl.NavigationControl());
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        maximumAge: 60 * 1000,
      },
      trackUserLocation: true,
      showUserHeading: true,
    }));


    const showPopup = (e) => {
      if (e?._stopPropagate) return;
      lastPopup?.remove();

      const feature = e.features[0];
      const coordinates = [...feature.geometry.coordinates];
      const content = buildPopupContent(feature);

      // Find the right marker if the map is zoomed out enough to wrap
      while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
      }

      lastPopup = new mapboxgl.Popup()
        .setLngLat(coordinates)
        .setDOMContent(content)
        .addTo(map);

      /* Mapbox propagates events through all layers in order,
       * so stop responding to this event after the first hit. */
      e._stopPropagate = true;
    };

    /* This determines the order of precedence when processing clicks */
    map.on('click', 'listings-bookmarked-markers', showPopup);
    map.on('click', 'listings-bookmarked-labels', showPopup);
    map.on('click', 'listings-other-markers', showPopup);
    map.on('click', 'listings-other-labels', showPopup);

    map.on('mouseenter', 'listings-bookmarked-markers', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'listings-bookmarked-markers', () => map.getCanvas().style.cursor = '');
    map.on('mouseenter', 'listings-other-markers', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'listings-other-markers', () => map.getCanvas().style.cursor = '');

    map.on('error', (response) => {
      console.log(`Error from map: ${response.error.message}`);
      map.getLayer('listings-bookmarked-markers').visibility = 'none';
      map.getLayer('listings-bookmarked-labels').visibility = 'none';
      map.getLayer('listings-other-markers').visibility = 'none';
      map.getLayer('listings-other-labels').visibility = 'none';
      throw response.error;
    });

    map.on('load', async () => {
      console.log(`Adding markers`);
      /* We need the markers in order to add the layer */
      for (const [name, img] of await markers) {
        map.addImage(name, img);
      }

      console.log(`Adding source and layers`);
      /* Apparently we can't create a source without data */
      const emptyGeojson = {
          'features': [],
          'type': 'FeatureCollection',
      };
      map.addSource('listings', { type: 'geojson', data: emptyGeojson });
      const markersSettings = {
        'type': 'symbol',
        'source': 'listings',
        'layout': {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      };
      const labelsSettings = {
        'type': 'symbol',
        'source': 'listings',
        'layout': {
          'text-field': ['get', 'name'],
          'text-variable-anchor': ['top'],
          'text-radial-offset': 1,
        },
        'paint': {
          'text-color': '#222',
          'text-halo-color': '#fff',
          'text-halo-width': 1,
          'text-halo-blur': 1,
        },
      };

      /* Markers go at the bottom visually */
      map.addLayer({...markersSettings, 'id': 'listings-other-markers'});
      map.addLayer({...markersSettings, 'id': 'listings-bookmarked-markers'});

      /* With labels above, and bookmarked labels topmost so they have priority */
      map.addLayer({
        ...labelsSettings,
        'id': 'listings-other-labels'
      });
      map.addLayer({
        ...labelsSettings,
        'id': 'listings-bookmarked-labels',
        'layout': {
          ...labelsSettings.layout,
          'text-justify': 'auto',
          /* Give them a little more chance of showing up */
          'text-variable-anchor': ['top', 'bottom'],
        },
      });

      console.log(`Map ready`);
      resolve(map);
    });

  });

  let listingDates;
  const buildDates = async (dateEl) => {
    const resp = await fetch(`maps/${year}/dates.json`);
    listingDates = await resp.json();
    const els = [];

    let lastDate;
    let defaultDate = 'all';
    for (const datestr of [...listingDates, 'all']) {
      if (datestr == 'all_week') {
        // Events scheduled to last all week
        els.push(`<input type="radio" name="date" value="all_week" id="date-all_week"><label for="date-all_week">Other</label>`);
        continue;
      } else if (datestr == 'no_events') {
        // Events with no dates scheduled yet
        els.push(`<input type="radio" name="date" value="no_events" id="date-no_events"><label for="date-no_events">Unknown</label>`);
        continue;
      } else if (datestr == 'all') {
        // Special option to show all listings
        els.unshift(`<div role="separator" class="date-gap"></div>`);
        els.unshift(`<input type="radio" name="date" value="all" id="date-all"><label for="date-all">All</label>`);
        continue;
      }

      const date = new Date(datestr);
      date.setHours(0, 0, 0, 0);

      if (lastDate && date - lastDate > 24 * 60 * 60 * 1000 * 1.5) {
        els.push(`<div role="separator" class="date-gap"></div>`);
      }

      const mm_dd = `${date.getDate()}/${date.getMonth() + 1}`;
      const day = date.toLocaleString('en-GB', {weekday: 'short'});
      let dayLabel = day;
      if (date - today == 0) {
        dayLabel = 'Today';
        defaultDate = datestr;
      } else {
        dayLabel = day;
      }
      const weekdayClass = (day == 'Sat' || day == 'Sun') ? "weekend" : "weekday";

      els.push(`<input type="radio" value="${datestr}" id="date-${datestr}" name="date"><label for="date-${datestr}" class="${weekdayClass}">${mm_dd} <small>${dayLabel}</small></label>`);

      lastDate = date;
    }
    dateEl.insertAdjacentHTML('afterbegin', els.join(''));
    document.forms.filter.date.value = defaultDate;
    document.body.classList.remove('not-ready');
  };

  const fromTimeEl = document.querySelector('#from_time');
  const toTimeEl = document.querySelector('#to_time');
  const timeRangeEl = fromTimeEl.closest('timerange');
  const timeTextEl = timeRangeEl.querySelector('.time-text');
  const updateTimeFilter = () => {
    const from = fromTimeEl.valueAsNumber;
    const to = 24 - toTimeEl.valueAsNumber;
    timeTextEl.innerText = `${formatTime(from)}-${formatTime(to)}`;
    const gap1 = from;
    const gap2 = to - from;
    const gap3 = 24 - to;
    let pos;
    // The 1 and 2 here should match the overhang size
    if (gap2 >= gap1 && gap2 >= gap3) {
      pos = from + gap2 / 2 + 1;
    } else if (gap1 >= gap3) {
      pos = gap1 / 2;
    } else {
      pos = 24 - gap3 / 2 + 2;
    }
    // The 26 here should match the slider-width calculation in the CSS
    // and widths must match input[type="range"] and .time-text
    timeTextEl.style.left = `calc(var(--track-width) / var(--text-scale) / 26 * ${pos} - 6em / 2 - var(--text-padding-sides))`;
  };
  const addTimeRangeHandlers = () => {
    timeTextEl.classList.add('movable');
    const checkTimeRange = (a, b) => {
      if (a.valueAsNumber > 24 - b.valueAsNumber) a.valueAsNumber = 24 - b.valueAsNumber;
      updateTimeFilter();
    }
    fromTimeEl.addEventListener('input', () => checkTimeRange(fromTimeEl, toTimeEl));
    toTimeEl.addEventListener('input', () => checkTimeRange(toTimeEl, fromTimeEl));
    fromTimeEl.addEventListener('change', () => checkTimeRange(fromTimeEl, toTimeEl));
    toTimeEl.addEventListener('change', () => checkTimeRange(toTimeEl, fromTimeEl));
    fromTimeEl.addEventListener('change', updateListings);
    toTimeEl.addEventListener('change', updateListings);
    updateTimeFilter();
  };


  const addScrollableHandlers = () => {
    const scrollable = document.querySelector('.scrollable.scroll-x');
    const dragThreshold = 4;

    scrollable.addEventListener('pointerdown', (e) => {
      if (e.pointerType != 'mouse') return;

      let startX = e.pageX - scrollable.offsetLeft;
      let scrollLeft = scrollable.scrollLeft;
      let dragged = false;
      let pointerId = e.pointerId;

      const scrollMove = (e) => {
        if (e.pointerId != pointerId) return;
        e.preventDefault();
        const x = e.pageX - scrollable.offsetLeft;
        const walkX = (x - startX) * 1;
        if (Math.abs(walkX) > dragThreshold) dragged = true;
        scrollable.scrollLeft = scrollLeft - walkX;
      };

      scrollable.style.cursor = 'grabbing';
      scrollable.addEventListener('pointermove', scrollMove);
      const scrollEnd = () => {
        scrollable.style.cursor = 'auto';
        scrollable.removeEventListener('pointermove', scrollMove);
        scrollable.removeEventListener('click', redispatch);
        scrollable.removeEventListener('mousedown', redispatch);
      };
      scrollable.addEventListener('lostpointercapture', scrollEnd);
      const redispatch = (e) => {
        if (!e.isTrusted) return;
        if (dragged) return;
        const actualTarget = document.elementFromPoint(e.clientX, e.clientY);
        if (actualTarget.closest('.scrollable') == scrollable) actualTarget.dispatchEvent(new e.constructor(e.type, e));
      };
      scrollable.addEventListener('click', redispatch);
      scrollable.addEventListener('mousedown', redispatch);
      scrollable.setPointerCapture(pointerId);
    });
  };

  class GoogleClient {
    CLIENT_ID = '136294280370-vkc203h8fv0ojaee9j4n1fqfick1pirg.apps.googleusercontent.com';
    API_KEY = 'AIzaSyBJ6FV7dy5vHpxevMub_EXm2PPpg-OSD3M';
    SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
    DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4', 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];

    constructor() {
      this.configFile = null;
      this.spreadsheetId = null;
      this.googleReady = null;
    }

    async initGoogle() {
      /*
        Sheets doesn't seem to support these:
        https://www.googleapis.com/auth/drive.appdata
        https://www.googleapis.com/auth/drive.appfolder
        https://www.googleapis.com/auth/drive.resource
       */
      if (!this.googleReady) {
        const loadScript = (src) => {
          return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.setAttribute('src', src);
            s.addEventListener('load', res);
            s.addEventListener('error', rej);
            document.body.appendChild(s);
          });
        };
        const loadApi = (api) => {
          return new Promise((res, rej) => {
            gapi.load(api, {callback: res, onerror: rej});
          });
        };
        const loadGapi = async () => {
          await loadScript('https://apis.google.com/js/api.js');
          await Promise.all([loadApi('client')]);
          await gapi.client.init({
            apiKey: this.API_KEY,
            discoveryDocs: this.DISCOVERY_DOCS,
          });
        };
        const loadGis = async () => {
          await loadScript('https://accounts.google.com/gsi/client');
        };
        this.googleReady = Promise.all([loadGapi(), loadGis()]);
      }
      return await this.googleReady;
    }

    /* Google's docs are bad, but their intention is for users
     * to do authentication before authorisation. `login_hint`
     * is used to pass the email address from the a12n flow to
     * a11n. Without this it will always show account selection
     * if the user has more than one account.
     */
    async authoriseGoogle(select_account = false) {
      /* The a11n flow always creates a popup, so should only be
       * called from a click handler.
       */
      return await new Promise((res, rej) => {
        /* Create the token client fresh each time, it's not heavy */
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.CLIENT_ID,
          scope: this.SCOPES,
          login_hint: localStorage.getItem('infraclub-google-login-hint'),
          callback: (resp) => {
            if (resp.error !== undefined) rej(resp);  // {error, error_description, error_uri}
            if (!resp.access_token) rej(resp);
            localStorage.setItem('infraclub-google-access-token', resp.access_token);
            res(resp.access_token);
          },
          error_callback: (err) => {
            console.log(`Error ${err.type} requesting token`);
            rej(err);  // {type, message, stack}
          },
        });

        /* In order of noisiness (all will open a popup):
         *  none           - no interaction allowed, only seems to work when the token's already valid
         *  ''             - prompt for account and consent as needed
         *  select_account - prompt for account even if login_hint is set, consent as needed
         *  consent        - prompt for account and consent always
         */
        this.tokenClient.requestAccessToken({prompt: select_account ? 'select_account' : ''});
      });
    }

    async authenticateGoogle() {
      /* This doesn't require a popup, but doesn't
       * really provide anything other than email and
       * user ID.
       *
       * Also annoyingly only allows portless URLs.
       */
      return await new Promise((res, rej) => {
        google.accounts.id.initialize({
          client_id: this.CLIENT_ID,
          auto_select: true,
          callback: ({credential}) => {
            const payload = JSON.parse(atob(credential.split('.')[1]));
            console.log(`User identified as ${payload.sub}`);
            localStorage.setItem('infraclub-google-login-hint', payload.sub);
            res(payload.sub);
          }
        });
        google.accounts.id.prompt((notification) => {
          console.log(`Authentication notification`, notification);
        });
      });
    }

    /* This can realistically only be deleted by
     * revoking this app's access, so keep it small. */
    async getConfigFile() {
      const list = await gapi.client.drive.files.list({
        spaces: 'appDataFolder',
        fields: 'files(id, name, version, owners)',
        q: 'name="config.json"',
        pageSize: 10,
      });
      console.log(`Number of files in appDataFolder: ${list.result.files.length}`);
      if (list.result.files.length == 0) {
        const newFile = await gapi.client.drive.files.create({
          /* Google drive docs are 100% lies */
          name: 'config.json',
          parents: ['appDataFolder'],
          uploadType: 'media',
          mimeType: 'application/json',
          fields: 'id, name, version, owners',
        });
        return newFile.result;
      }
      /* Deal with the list/create race */
      if (list.result.files.length > 1) {
        list.result.files.sort((a, b) => strcmp(a.id, b.id));
        for (const [i, file] of list.result.files.entries()) {
          if (i == 0) continue;
          console.log(`Deleting redundant config file ${file.id}`);
          await gapi.client.drive.files.delete({
            fileId: file.id,
          });
        }
      }
      return list.result.files[0];
    }

    async loadConfig() {
      /* I can't imagine why this wouldn't be the case */
      if (this.configFile.owners[0].me) {
        /* permissionId isn't the same as the Google user ID, annoyingly */
        localStorage.setItem('infraclub-google-login-hint', this.configFile.owners[0].emailAddress);
      }
      const content = await gapi.client.drive.files.get({
        fileId: this.configFile.id,
        alt: 'media',
      });
      if (!content.body) {
        console.log(`Empty config`);
        /* Migration for pre-config users */
        if (this.spreadsheetId) this.saveConfig();
        return;
      }
      const config = JSON.parse(content.body);
      console.log(`Loaded config from ${this.configFile.id} version ${this.configFile.version}`, config);
      if (!config.spreadsheetId) return;
      this.setSpreadsheetId(config.spreadsheetId);
    }

    async saveConfig() {
      console.warn(`Saving ${this.spreadsheetId}`);
      const data = {
        'spreadsheetId': this.spreadsheetId,
      };
      if (false) {
        /* https://github.com/google/google-api-javascript-client/issues/672 */
        return await gapi.client.drive.files.update({
          fileId: this.configFile.id,
          uploadType: 'media',
          resource: JSON.stringify(data),
          fields: 'id, version, name',
        });
      } else {
        return await gapi.client.request({
          path: `https://www.googleapis.com/upload/drive/v3/files/${this.configFile.id}`,
          method: 'PATCH',
          params: {
            uploadType: 'media',
            fields: 'id, version, name',
          },
          body: JSON.stringify(data),
        });
      }
    }

    async initConfigFile() {
      if (!this.configFile) {
        this.configFile = await this.getConfigFile();
      }
    }

    async handleAuthFailure(promise) {
      let disconnect = false;
      try {
        return await promise;
      } catch (err) {
        if (err.status == 404) {
          console.log(`Spreadsheet returned 404, possibly session expired`, err);
          disconnect = true;
        } else if (err.status == 403) {
          console.log(`Spreadsheet returned 403, possibly no permissions or rate limited`, err);
          disconnect = true;
        } else if (err.status == 401) {
          console.log(`Spreadsheet returned 401, session expired or permission revoked`, err);
          disconnect = true;
        } else {
          throw err;
        }
      }
      if (disconnect) {
        googleStatus.innerText = 'Connect';
        document.querySelector('.google').classList.remove('connected');
        gapi?.client?.setToken(null);
      }
    }

    async initSpreadsheet() {
      if (this.spreadsheetId) {
        gc.pollSpreadsheet();
      }
      if (!this.spreadsheetId) {
        this.setSpreadsheetId(await this.getSpreadsheetId());
        /* loadConfig will have been called, so we know this is empty/wrong */
        this.saveConfig();
      }
      const spreadsheet = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    }

    async pollSpreadsheet() {
      const file = await gapi.client.drive.files.get({
        fileId: this.spreadsheetId,
        fields: 'id, version, trashed',
      });
      if (!file.result.id) {
        console.log(`Spreadsheet ${this.spreadsheetId} not found`);
        this.setSpreadsheetId(null);
        return;
      }
      if (file.result.trashed) {
        console.log(`Spreadsheet ${this.spreadsheetId} has been trashed`);
        this.setSpreadsheetId(null);
        return;
      }
      console.log(`Spreadsheet ${this.spreadsheetId} looks good`);
      /* accessToken validity is an hour */
      setTimeout(async () => await gc.handleAuthFailure(gc.pollSpreadsheet()), 61 * 60 * 1000);
    }

    async getSpreadsheetId() {
      const list = await gapi.client.drive.files.list({
        spaces: 'drive',
        /* Google drive docs are 100% lies */
        q: 'trashed = false',
        fields: 'files(id, name, createdTime)',
        pageSize: 10,
      });
      console.log(`Number of files in drive: ${list.result.files.length}`);
      if (list.result.files.length == 0) {
        const title = 'Infrastructure Club Open House London 2023';
        const newSheet = await gapi.client.sheets.spreadsheets.create({
          properties: { title },
          fields: 'spreadsheetId',
        });
        return newSheet.result.spreadsheetId;
      }
      /* Deal with the list/create race */
      if (list.result.files.length > 1) {
        list.result.files.sort((a, b) => a.createdTime == b.createdTime ? strcmp(a.id, b.id) : strcmp(a.createdTime, b.createdTime));
        console.log(`Multiple sheets found, using ${list.result.files[0].id}`);
        /* Unlike getConfigFile, this is only called when we don't know the ID.
         * We're therefore much less likely to ever see a race, so don't bother
         * trashing it ourselves. */
      }
      return list.result.files[0].id;
    }

    setSpreadsheetId(spreadsheetId) {
      localStorage.setItem('infraclub-spreadsheet-id', spreadsheetId);
      this.spreadsheetId = spreadsheetId;
    }

    async loadData() {
      const resp = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'A:D',
      });
      if (!resp.result.values) return;
      if (JSON.stringify(resp.result.values[0]) != '["id","name","date","state"]') {
        throw "Headings do not match expected format";
      }
      for (const [id, name, date, state] of resp.result.values.slice(1)) {
        setFavourite(id, name, date, state);
      }
    }

    async saveData() {
      this.saving = true;
      const data = [];
      for (const [id, dates] of Object.entries(favourites)) {
        for (const [date, {name, state}] of Object.entries(dates)) {
          data.push([id, name, date, state]);
        }
      }
      // Sort by id, and then date
      data.sort((a, b) => a[0] == b[0] ? a[2] - b[2] : a[0] - b[0]);
      data.unshift(['id', 'name', 'date', 'state']);
      const resp = await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'A:D',
        valueInputOption: 'RAW',
        values: data,
      });
      this.saving = false;
    }

  }

  const favourites = {};
  window.favourites = favourites;
  const savedFavourites = localStorage.getItem('infraclub-favourites');
  if (savedFavourites) Object.assign(favourites, JSON.parse(savedFavourites));

  const saveFavourites = async () => {
    localStorage.setItem('infraclub-favourites', JSON.stringify(favourites));
    const map = await mapReady;
    updateProperties(currentListings);
    map.getSource('listings').setData(currentListings);

    if (window?.gapi?.client?.getToken()?.access_token == null) return;
    googleStatus.innerText = 'Saving';
    await gc.handleAuthFailure(gc.saveData());
    googleStatus.innerText = 'Saved';
  };
  const setFavourite = (id, name, date, state) => {
    if (!favourites[id]) favourites[id] = {};
    favourites[id][date] = {name, state};
  };

  const gc = new GoogleClient();
  window.gc = gc;

  await domContentLoaded;

  const googleStatus = document.querySelector('.google-status');
  document.querySelector('.google-status').addEventListener('click', () => {
    window.open(`https://docs.google.com/spreadsheets/d/${gc.spreadsheetId}/edit`, '_blank');
  });

  const loadFromGoogle = async () => {
    await gc.loadConfig();
    await gc.initSpreadsheet();
    await gc.loadData();
    googleStatus.innerText = 'Loaded';
    document.querySelector('.google').classList.add('connected');
    if (currentListings) {
      const map = await mapReady;
      updateProperties(currentListings);
      map.getSource('listings').setData(currentListings);
    }
  }

  document.querySelector('.google-connect').addEventListener('click', async () => {
    await gc.initGoogle();
    await gc.authoriseGoogle();
    await gc.initConfigFile();
    await gc.handleAuthFailure(loadFromGoogle());
  });

  const tryLoadFromGoogle = async () => {
    /* We can't use popups here */
    const accessToken = localStorage.getItem('infraclub-google-access-token');
    if (!accessToken) return;
    await gc.initGoogle();
    gapi.client.setToken({access_token: accessToken});
    try {
      await gc.initConfigFile();
    } catch (err) {
      if (err.status == 401 || err.status == 403) {
        /* Quietly fail */
        console.log(`Error ${err.status} using token, can't reconnect`);
        return;
      } else {
        throw err;
      }
    }
    await gc.handleAuthFailure(loadFromGoogle());
  };
  tryLoadFromGoogle();

  window.addEventListener('beforeunload', (e) => {
    if (gc.saving) {
      /* MDN docs are wrong, you can't just return "" any more */
      e.returnValue = "Changes you made may not be saved.";
      e.preventDefault();
    }
  });


  addTimeRangeHandlers();
  addScrollableHandlers();
  document.forms.filter.addEventListener('change', (e) => {
    if (e.target.closest('input')) updateListings();
  });

  document.forms.filter.addEventListener('submit', (e) => {
    e.preventDefault();
  });

  let searchTimer = null;
  document.querySelector('#search').addEventListener('input', (e) => {
    const search = document.forms.filter.search.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      updateListings();
      searchTimer = null;
    }, [1, 2].includes(search.length) ? 1000 : 100);
  });

  const resizeMap = async () => {
    const map = await mapReady;
    map.resize();
  };
  document.querySelector('.expand').addEventListener('click', resizeMap);

  const dateEl = document.getElementById('date');
  await buildDates(dateEl);
  loadFilter();
  dateEl.querySelector(':checked').scrollIntoView({ inline: 'center' });
  await updateListings();

})();
