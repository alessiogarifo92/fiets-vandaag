// Source catalog. NL and IT are typed against it, and a unit test checks keys and {placeholders} match.

export const en = {
  'app.name': 'Fiets Vandaag',
  'nav.today': 'Today',
  'nav.hours': 'Hour by hour',
  'nav.privacy': 'Privacy',
  'nav.about': 'About',
  'nav.editRoute': 'Edit route',
  'nav.back': 'Back',
  'lang.label': 'Language',

  'setup.progress': 'Step {step} of 3',
  'setup.heading.from': 'I cycle from',
  'setup.heading.to': 'to',
  'setup.heading.between': 'on the road between',
  'setup.heading.and': 'and',
  'setup.from.label': 'Start address',
  'setup.to.label': 'Destination',
  'setup.address.placeholder': 'Street and number, or postcode',
  'setup.address.searching': 'Searching…',
  'setup.address.none': 'No address found. Try a street and number.',
  'setup.address.error': 'Address search is unavailable right now. Try again.',
  'setup.window.start': 'Earliest departure',
  'setup.window.end': 'Arrive by',
  'setup.ride': 'About {min} min by bike',
  'setup.next': 'Next',
  'setup.back': 'Back',
  'setup.save': "See today's advice",
  'setup.error.tooClose': 'Start and destination are too close together.',
  'setup.error.tooFar': 'That is more than {km} km: too far for a bike commute.',
  'setup.error.window': 'The window must be {hours} hours or less, and end after it starts.',
  'setup.error.rideTooLong': 'The ride takes about {min} min and does not fit in this window.',
  'setup.privacy': 'Your addresses stay on this phone. Only a ~1 km area is used for the weather.',
  'setup.privacy.link': 'How your data is used',

  'today.today': 'Today',
  'today.tomorrow': 'Tomorrow',
  'today.loading': 'Fetching the forecast…',
  'today.error': 'The forecast is unavailable right now. Try again in a minute.',
  'today.retry': 'Try again',
  'today.forecastAt': 'Forecast of {time}',
  'today.stale': 'Could not refresh: showing the forecast of {date} {time}',
  'today.score': 'Bike score {score}/10',
  'today.window': 'Your window {start}–{end}',
  'today.hours': 'Hour by hour',

  'pill.bike': 'Bike · leave {time}',
  'pill.shift': 'Bike · leave {time}',
  'pill.pt': 'Public transport',

  'sentence.bike': 'Good cycling weather: leave at {time}.',
  'sentence.bike.tailwind': 'Leave at {time} and the wind is at your back.',
  'sentence.bike.rain': 'Leave at {time} and pack a rain jacket, just in case.',
  'sentence.bike.wind': 'Leave at {time}; expect to push against the wind.',
  'sentence.shift.rain': 'Leave at {time} instead and you miss the rain.',
  'sentence.shift.wind': 'Leave at {time} instead, when the wind is easier.',
  'sentence.pt.rain': 'Take public transport: it rains through your whole window.',
  'sentence.pt.wind': 'Take public transport: the wind is too strong today.',
  'sentence.pt.storm': 'Stay off the bike: gusts up to {gust} km/h.',
  'sentence.pt.mixed': 'Take public transport: wind and rain together are against you.',

  'wind.head': 'Headwind {speed} km/h',
  'wind.tail': 'Tailwind {speed} km/h',
  'wind.cross': 'Crosswind {speed} km/h',
  'wind.light': 'Light wind {speed} km/h',
  'wind.gusts': 'gusts {gust} km/h',
  'rain.dry': 'dry',
  'rain.chance': '{prob}% chance of rain',
  'rain.amount': '{prob}% chance of rain, about {mm} mm',

  'timeline.title': 'Your commute window',
  'timeline.rain': 'Rain chance',
  'timeline.wind': 'Headwind',
  'timeline.label': 'Rain chance and headwind per hour, {start} to {end}',

  'hours.title': 'Hour by hour',
  'hours.intro': 'The hours around your window, with the wind relative to your ride.',
  'hours.best': 'Best moment',
  'hours.time': 'Time',
  'hours.rain': 'Rain',
  'hours.wind': 'Wind',
  'hours.arrow': 'Wind towards {deg}° relative to your direction',
  'hours.phrase.head': 'headwind',
  'hours.phrase.tail': 'tailwind',
  'hours.phrase.cross': 'crosswind',
  'hours.phrase.light': 'light wind',
  'hours.phrase.dry': 'dry',
  'hours.phrase.showers': 'showers',
  'hours.phrase.chance': 'chance of rain',

  'attribution.prefix': 'Weather data:',

  'privacy.title': 'Privacy',
  'privacy.intro': 'Fiets Vandaag has no accounts. This page lists every place your data goes.',
  'privacy.phone.title': 'Stays on this phone',
  'privacy.phone.body':
    'Your start and destination addresses, their coordinates, your commute window, your language and the last forecast. They are stored in this browser (IndexedDB) and are deleted when you clear the site data.',
  'privacy.pdok.title': 'PDOK (address search)',
  'privacy.pdok.body':
    'The text you type in the address fields is sent to the PDOK Locatieserver of the Dutch government (api.pdok.nl), together with your IP address, to suggest matching addresses.',
  'privacy.meteo.title': 'Open-Meteo (weather)',
  'privacy.meteo.body':
    'Your phone asks Open-Meteo (api.open-meteo.com) for the forecast of a ~1 km area around the middle of your route, never your addresses. Open-Meteo sees that area and your IP address.',
  'privacy.server.title': 'Our server',
  'privacy.server.body':
    'Nothing yet: today the app works without our server. When morning notifications arrive, the server will store only your push subscription, the ~1 km area and direction of your route, and your schedule, and this page will say so first.',
  'privacy.delete.title': 'Deleting',
  'privacy.delete.body':
    'Clear this site’s data in your browser settings to remove everything stored on this phone.',

  'about.title': 'About',
  'about.body':
    'Every morning: bike, public transport, or leave a bit later? Fiets Vandaag reads the wind against your route and the rain in your commute window.',
  'about.version': 'Version {version}',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
