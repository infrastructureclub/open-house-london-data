"use strict";

(async () => {
  const formatTimePart = (n) => `${String(Math.floor(n)).padStart(2, '0')}`;
  const formatTime = (t) => `${formatTimePart(t)}:${formatTimePart((t % 1) * 60)}`;

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

  const updateProperties = (listings) => {
    for (const feature of listings.features) {
      const props = feature.properties;
      props.match = false;
      props.state = '';
      props.icon = 'marker-red';
      const search = document.forms.filter.search.value;
      if (search) {
        props.match = (
          props.description.toLowerCase().includes(search.toLowerCase()) ||
          props.name.toLowerCase().includes(search.toLowerCase())
        );
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
    switch (document.forms.filter.bookmarked.value) {
      case 'yes': filter.push(['in', ['get', 'state'], ['literal', ['bookmarked']]]); break;
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
    map.getLayer('listings-markers').visibility = 'visible';
    map.getLayer('listings-labels').visibility = 'visible';

    console.log(`Updating filters`);
    const filter = getListingsFilter();
    map.setFilter('listings-labels', filter);
    map.setFilter('listings-markers', filter);
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
    const { name, description, url, new_venue_this_year, fully_booked, ticketed_events, start, end } = feature.properties;
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
      /* MapBox passes clicks through to all listening layers.
       * This now means you can't click between events easily. */
      if (lastPopup?.isOpen()) return;

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
    };

    map.on('click', 'listings-markers', showPopup);
    map.on('click', 'listings-labels', showPopup);

    map.on('mouseenter', 'listings-markers', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'listings-markers', () => map.getCanvas().style.cursor = '');

    map.on('error', (response) => {
      console.log(`Error from map: ${response.error.message}`);
      map.getLayer('listings-markers').visibility = 'none';
      map.getLayer('listings-labels').visibility = 'none';
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
      map.addLayer({
        'id': 'listings-markers',
        'type': 'symbol',
        'source': 'listings',
        'layout': {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      map.addLayer({
        'id': 'listings-labels',
        'type': 'symbol',
        'source': 'listings',
        'layout': {
          'text-field': ['get', 'name'],
          'text-variable-anchor': ['top'],
          'text-radial-offset': 1,
        },
        'paint': {
          'text-halo-color': '#fff',
          'text-halo-width': 1,
          'text-halo-blur': 1,
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
    for (const datestr of [...listingDates, 'all']) {
      if (datestr == 'all_week') {
        // Events scheduled to last all week
        els.push(`<input type="radio" name="date" value="all_week" id="date-all_week"><label for="date-all_week">Other</label>`);
        continue;
      } else if (datestr == 'all') {
        // Special option to show all listings
        els.unshift(`<div role="separator" class="date-gap"></div>`);
        els.unshift(`<input type="radio" name="date" value="all" id="date-all"><label for="date-all">All</label>`);
        continue;
      }

      const date = new Date(datestr);
      date.setHours(0, 0, 0, 0);
      if (hashYear == null && date < today) continue;

      if (lastDate && date - lastDate > 24 * 60 * 60 * 1000 * 1.5) {
        els.push(`<div role="separator" class="date-gap"></div>`);
      }

      const mm_dd = `${date.getDate()}/${date.getMonth() + 1}`;
      const day = date.toLocaleString('en-GB', {weekday: 'short'});
      const dayLabel = (date - today == 0) ? "Today" : day;
      const weekdayClass = (day == 'Sat' || day == 'Sun') ? "weekend" : "weekday";

      els.push(`<input type="radio" value="${datestr}" id="date-${datestr}" name="date"><label for="date-${datestr}" class="${weekdayClass}">${mm_dd} <small>${dayLabel}</small></label>`);

      lastDate = date;
    }
    dateEl.insertAdjacentHTML('afterbegin', els.join(''));
    document.forms.filter.date.value = document.forms.filter.date[0].value;
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
    SCOPES = 'https://www.googleapis.com/auth/drive.file';
    DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

    constructor() {
      this.spreadsheetId = null;
    }

    async initGoogle() {
      /*
        Sheets doesn't seem to support these:
        https://www.googleapis.com/auth/drive.appdata
        https://www.googleapis.com/auth/drive.appfolder
        https://www.googleapis.com/auth/drive.resource
       */

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
        await Promise.all([loadApi('client'), loadApi('picker')]);
        await gapi.client.init({
          apiKey: this.API_KEY,
          discoveryDocs: [this.DISCOVERY_DOC],
        });
      };
      const loadGis = async () => {
        await loadScript('https://accounts.google.com/gsi/client');
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.CLIENT_ID,
          scope: this.SCOPES,
          // FIXME: make this a Promise too
          callback: null,
          // TODO
          error_callback: null,
        });
      };
      await Promise.all([loadGapi(), loadGis()]);
    };

    async authGoogle() {
      // Should only be called from a click handler as it creates a popup
      return await new Promise((res, rej) => {
        this.tokenClient.callback = (resp) => {
          if (resp.error !== undefined) rej(resp);
          if (!resp.access_token) rej(resp);
          localStorage.setItem('infraclub-google-access-token', resp.access_token);
          res(resp.access_token);
        };

        // If they've connected before we only need a click through
        const prompt = (gapi.client.getToken() === null) ? 'consent' : '';
        this.tokenClient.requestAccessToken({prompt});
      });
    }

    async checkSpreadsheet() {
      const spreadsheetId = localStorage.getItem('infraclub-spreadsheet-id');
      // If this fails we want to show the create/pick button
      if (spreadsheetId) {
        try {
          const spreadsheet = await gapi.client.sheets.spreadsheets.get({ spreadsheetId });
          this.spreadsheetId = spreadsheetId;
        } catch (err) {
          if (err.status == 404) {
            console.log(`Spreadsheet returned 404`);
          } else if (err.status == 403) {
            // TODO: we could try reauthing here?
            console.log(`Spreadsheet returned 403, possibly session expired`);
          }
        }
      }
      return this.spreadsheetId;
    };

    setSpreadsheet(spreadsheetId) {
      localStorage.setItem('infraclub-spreadsheet-id', spreadsheetId);
      this.spreadsheetId = spreadsheetId;
    }

    async createSpreadsheet() {
      const title = 'Infrastructure Club Open House London 2023';
      const resp = await gapi.client.sheets.spreadsheets.create({
        properties: { title },
        fields: 'spreadsheetId',
      });
      return resp.result.spreadsheetId;
    }

    async pickSpreadsheet() {
      return await new Promise((resolve, reject) => {
        const callback = (data) => {
          if (data[google.picker.Response.ACTION] == google.picker.Action.PICKED) {
            const doc = data[google.picker.Response.DOCUMENTS][0];
            const id = doc[google.picker.Document.ID];
            resolve(id);
          }
        };
        const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
          .setQuery('Infrastructure Club Open House London 2023')
          .setMode(google.picker.DocsViewMode.LIST);
        const picker = new google.picker.PickerBuilder()
          .addView(view)
          .enableFeature(google.picker.Feature.NAV_HIDDEN)
          .hideTitleBar()
          .setOAuthToken(gapi.client.getToken().access_token)
          .setDeveloperKey(this.API_KEY)
          .setCallback(callback)
          .build();
        picker.setVisible(true);
      });
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
      const data = [];
      for (const [id, dates] of Object.entries(favourites)) {
        for (const [date, {name, state}] of Object.entries(dates)) {
          data.push([id, name, date, state]);
        }
      }
      // Sort by id, and then date
      data.sort((a, b) => a[0] == b[0] ? b[2] - a[2] : b[0] - a[0]);
      data.unshift(['id', 'name', 'date', 'state']);
      const resp = await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'A:D',
        valueInputOption: 'RAW',
        values: data,
      });
      googleStatus.innerText = 'Saved';
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

    if (window?.gapi?.client?.getToken() == null) return;
    googleStatus.innerText = 'Saving';
    gc.saveData();
  };
  const setFavourite = (id, name, date, state) => {
    if (!favourites[id]) favourites[id] = {};
    favourites[id][date] = {name, state};
  };

  const gc = new GoogleClient();

  await domContentLoaded;

  const googleStatus = document.querySelector('.google-status');
  document.querySelector('.google-status').addEventListener('click', () => {
    // TODO: use checkSpreadsheet to get this
    window.open(`https://docs.google.com/spreadsheets/d/${gc.spreadsheetId}/edit`, '_blank');
  });

  const loadData = async () => {
    await gc.loadData();
    googleStatus.innerText = 'Loaded';
    document.querySelector('.connect-google').classList.add('connected');
    if (currentListings) {
      const map = await mapReady;
      updateProperties(currentListings);
      map.getSource('listings').setData(currentListings);
    }
  }
  document.querySelector('.google-new').addEventListener('click', async () => {
    await gc.initGoogle();
    await gc.authGoogle();
    gc.setSpreadsheet(await gc.createSpreadsheet());
    await loadData();
  });
  document.querySelector('.google-existing').addEventListener('click', async () => {
    document.querySelector('.button-down').checked = false;
    await gc.initGoogle();
    await gc.authGoogle();
    gc.setSpreadsheet(await gc.pickSpreadsheet());
    await loadData();
  });
  const tryLoadFromGoogle = async () => {
    const accessToken = localStorage.getItem('infraclub-google-access-token');
    if (!accessToken) return;
    await gc.initGoogle();
    gapi.client.setToken({access_token: accessToken});
    // TODO: check if token is valid, and skip authGoogle later if so
    if (!await gc.checkSpreadsheet()) return;
    await loadData();
  };
  tryLoadFromGoogle();

  addTimeRangeHandlers();
  addScrollableHandlers();
  document.forms.filter.addEventListener('click', (e) => {
    if (e.target.closest('input')) updateListings();
  });

  document.forms.filter.addEventListener('submit', (e) => {
    e.preventDefault();
  });

  let searchTimer = null;
  const doSearch = () => {
    updateListings();
    searchTimer = null;
  };
  document.querySelector('#search').addEventListener('input', (e) => {
    const search = document.forms.filter.search.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, [1, 2].includes(search.length) ? 1000 : 100);
  });
  document.querySelector('#search').addEventListener('change', doSearch);

  const updateAriaExpanded = () => {
    const el = document.querySelector('.button-down');
    el.setAttribute('aria-expanded', el.checked);
  };
  document.querySelector('.button-down').addEventListener('input', updateAriaExpanded);
  document.querySelector('.button-down').addEventListener('change', updateAriaExpanded);
  const hideMenuOnBlur = (e) => {
    if (!e?.relatedTarget?.closest('.button-menu')) {
      document.querySelector('.button-down').checked = false;
      updateAriaExpanded();
    }
  };
  document.querySelector('.button-down').addEventListener('focusout', hideMenuOnBlur);
  document.querySelector('.button-menu').addEventListener('focusout', hideMenuOnBlur);
  document.body.addEventListener('keydown', (e) => {
    if (e.key == 'Escape') {
      document.querySelector('.button-down').checked = false;
      updateAriaExpanded();
    }
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
