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


  const getListingsUrl = () => {
    const date = document.forms.filter.date.value;
    return `maps/${year}/geojson/${date}.geojson`;
  };

  const getListingsFilter = () => {
    const filter = ['all', ['literal', true]];
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
    return filter;
  };

  const updateListings = async () => {
    const map = await mapReady;
    console.log(`Updating listings`);
    map.getSource('listings').setData(getListingsUrl());
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
    const ticketed_events = document.forms.filter.ticketed_events.value;
    const fully_booked = document.forms.filter.fully_booked.value;
    const from_time = document.forms.filter.from_time.valueAsNumber;
    const to_time = 24 - document.forms.filter.to_time.valueAsNumber;
    hash.set('filter', `${date}/${from_time}/${to_time}/${ticketed_events}/${fully_booked}`);
    document.location.hash = '#' + hash.toString().replaceAll('%2F', '/');
  };

  const loadFilter = () => {
    const hash = new URLSearchParams(document.location.hash.substr(1));
    const filter = hash.get('filter');
    if (!filter) return;
    const [date, from_time, to_time, ticketed_events, fully_booked] = filter.split('/');
    /* These assignments will be ignored if the values are invalid */
    document.forms.filter.date.value = date;
    document.forms.filter.from_time.valueAsNumber = from_time;
    document.forms.filter.to_time.valueAsNumber = 24 - to_time;
    document.forms.filter.ticketed_events.value = ticketed_events;
    document.forms.filter.fully_booked.value = fully_booked;
    updateTimeFilter();
  };


  const buildPopupHtml = (feature) => {
    const { name, description, url, fully_booked, ticketed_events, start, end } = feature.properties;
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
    const coords = feature.geometry.coordinates;
    const latlng = `${coords[1]},${coords[0]}`;
    const gmapsParams = new URLSearchParams({'api': 1, 'destination': latlng});
    const gmapsUrl = `https://www.google.com/maps/dir/?${gmapsParams}`;
    const cmParams = new URLSearchParams({'endcoord': latlng, 'endname': name});
    const cmUrl = `https://citymapper.com/directions?${cmParams}`;
    return `
      <a href="${url}" target="_blank">${name}</a>
      <p>${description}</p>
      <p>
        <a class="gmaps-link" href="${gmapsUrl}" target="_blank">
          <img src="assets/googlemaps-icon-167px.png"/>
        </a>
        <a class="cm-link" href="${cmUrl}" target="_blank">
          <img src="assets/citymapper-logo-220px.png"/>
        </a>
      </p>
      <dl>${data.join('\n')}</dl>
    `;
  };


  const fetchMarkers = () => {
    const markers = {
      'marker': 'assets/mapbox-marker-icon-48px-red.png',
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


    let lastPopup = null;
    const showPopup = (e) => {
      /* MapBox passes clicks through to all listening layers.
       * This now means you can't click between events easily. */
      if (lastPopup?.isOpen()) return;

      const feature = e.features[0];
      const coordinates = [...feature.geometry.coordinates];
      const html = buildPopupHtml(feature);

      // Find the right marker if the map is zoomed out enough to wrap
      while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
      }

      lastPopup = new mapboxgl.Popup()
        .setLngLat(coordinates)
        .setHTML(html)
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
    });

    map.on('load', async () => {
      console.log(`Adding markers`);
      /* We need the markers in order to add the layer */
      for (const [name, img] of await markers) {
        map.addImage(name, img);
      }

      console.log(`Adding source and layers`);
      /* Apparently we can't create a source without data */
      map.addSource('listings', { type: 'geojson', data: getListingsUrl() });
      map.addLayer({
        'id': 'listings-markers',
        'type': 'symbol',
        'source': 'listings',
        'layout': {
          'icon-image': 'marker',
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

  const buildDates = async (dateEl) => {
    const resp = await fetch(`maps/${year}/dates.json`);
    const dates = await resp.json();
    const els = [];

    let lastDate;
    for (const datestr of dates) {
      if (datestr == 'all_week') {
          els.push(`<input type="radio" name="date" value="all_week" id="date-all_week"><label for="date-all_week">Other</label>`);
          continue;
      }

      const date = new Date(datestr);
      date.setHours(0, 0, 0, 0);
      if (hashYear == null && date < today) continue;

      if (lastDate && date - lastDate > 24 * 60 * 60 * 1000 * 1.5) {
        els.push(`<div class="date-gap"></div>`);
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
    timeTextEl.innerText = `${formatTime(fromTimeEl.valueAsNumber)}-${formatTime(24 - toTimeEl.valueAsNumber)}`;
  };
  const addTimeRangeHandlers = () => {
    const checkTimeRange = (a, b) => {
      if (a.valueAsNumber > 24 - b.valueAsNumber) a.valueAsNumber = 24 - b.valueAsNumber;
      updateTimeFilter();
    }
    fromTimeEl.addEventListener('input', () => checkTimeRange(fromTimeEl, toTimeEl));
    toTimeEl.addEventListener('input', () => checkTimeRange(toTimeEl, fromTimeEl));
  };

  await domContentLoaded;

  addTimeRangeHandlers();
  document.forms.filter.addEventListener('click', (e) => {
    if (e.target.closest('input')) updateListings();
  });

  const dateEl = document.getElementById('date');
  await buildDates(dateEl);
  loadFilter();
  dateEl.querySelector(':checked').scrollIntoView({ inline: 'center' });
  await updateListings();

})();
