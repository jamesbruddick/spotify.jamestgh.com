import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import express from 'express';
// import session from 'express-session';
// import MongoStore from 'connect-mongo';
import { WebSocket, WebSocketServer } from 'ws';
import { MongoClient, ServerApiVersion } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { PORT, MONGODB, SPOTIFY_CLIENTID, SPOTIFY_CLIENTSECRET, SESSION_SECRET } = process.env;
let SPOTIFY_ACCESSTOKEN, SPOTIFY_ATEXPIRESAT, SPOTIFY_REFRESHTOKEN, SPOTIFY_CURRENTLYPLAYING;

const app = express();
const mongo = new MongoClient(MONGODB, { serverApi: ServerApiVersion.v1 });
const wssClients = new Map();

app.locals.pretty = true;
app.set('trust proxy', true);
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
// app.use(session({
// 	secret: SESSION_SECRET,
// 	cookie: { secure: true, httpOnly: false },
// 	name: 'spotify-sid',
// 	resave: false,
// 	saveUninitialized: true,
// 	store: MongoStore.create({
// 		mongoUrl: MONGODB,
// 		dbName: 'spotify',
// 		collectionName: 'spotify-sessions',
// 		autoRemove: 'interval',
// 		autoRemoveInterval: 1440
// 	})
// }));
app.disable('x-powered-by');

const wss = new WebSocketServer({ 
	server: app.listen(PORT, () => { 
		console.log(`[${new Date().toISOString()}]: The NodeJS application (${__dirname.split('/').pop()}) is running on port ${PORT};`) 
	})
});

function generateRandomId(length) {
	const characters = '0123456789ABCDEF';
	return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
}

wss.on('connection', async (ws, req) => {

	const wssClientId = generateRandomId(16);
	const wssClientIp = req.headers['x-forwarded-for'].split(',')[0].trim();

	wssClients.set(wssClientId, ws);

	// console.log(`[${new Date().toISOString()}]: ${wssClientIp} websocket client (${wssClientId}) connected`);

	setInterval(() => {
		try {
			if (ws.readyState === WebSocket.OPEN) ws.ping();
		} catch (error) {
			console.error(`[${new Date().toISOString()}]: ${error.message}`);
		}
	}, 20e3);

	if (ws.readyState === WebSocket.OPEN) {

		ws.send(JSON.stringify({
			type: 'ws-client-id',
			data: wssClientId
		}));

		ws.send(JSON.stringify({
			type: 'spotify-currently-playing',
			data: SPOTIFY_CURRENTLYPLAYING
		}));

		try {
			const spotifyPlayerHistory = await mongo.db('spotify').collection('spotify-player-history').find({}).sort({ timestamp: -1 }).skip(1).limit(10).toArray();
			ws.send(JSON.stringify({
				type: 'spotify-player-history',
				data: spotifyPlayerHistory
			}));
		} catch (error) {
			console.error(`[${new Date().toISOString()}]: ${error.message}`);
		}
	}

	ws.on('message', async (message) => {
		const response = JSON.parse(message);
		switch (response.type) {
			// case 'session-access-status':
			// 	await sessionAccessStatus(response.data, response.wsid);
			// 	break;
			// case 'session-access-request':
			// 	await sessionAccessRequest(response.data, response.wsid);
			// 	break;
			// case 'session-access-toggle':
			// 	await sessionAccessToggle(response.data, response.wsid);
			// 	break;
			// case 'session-access-admin':
			// 	await sessionAccessAdmin(response.wsid);
			// 	break;
			case 'spotify-search-track':
				await spotifySearchTrack(response.data, response.wsid);
				break;
		}
	});

	ws.on('error', (error) => {
		wssClients.delete(wssClientId);
		console.error(`[${new Date().toISOString()}]: ${wssClientIp} websocket client (${wssClientId}) encountered an error (${error.message})`);
	});

	ws.on('close', () => {
		wssClients.delete(wssClientId);
		// console.log(`[${new Date().toISOString()}]: ${wssClientIp} websocket client (${wssClientId}) disconnected`);
	});
});

wss.on('error', (error) => {
	console.error(`[${new Date().toISOString()}]: ${error.message}`);
});

async function refreshSpotifyAccessToken() {
	try {
		const requestOptions = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Authorization': 'Basic ' + (new Buffer.from(`${SPOTIFY_CLIENTID}:${SPOTIFY_CLIENTSECRET}`).toString('base64'))
			},
			body: `grant_type=refresh_token&refresh_token=${SPOTIFY_REFRESHTOKEN}`
		};

		const spotifyResponse = await fetch('https://accounts.spotify.com/api/token', requestOptions);

		if (spotifyResponse.ok) {
			const spotifyAuthorizationData = await spotifyResponse.json();

			SPOTIFY_ACCESSTOKEN = spotifyAuthorizationData.access_token;
			SPOTIFY_ATEXPIRESAT = Date.now() + (spotifyAuthorizationData.expires_in * 1e3)

			try {
				await mongo.db('spotify').collection('spotify-authorization').updateOne({}, {
					$set: {
						access_token: SPOTIFY_ACCESSTOKEN,
						access_token_expires_at: SPOTIFY_ATEXPIRESAT
					}
				}, { upsert: true });

				console.log(`[${new Date().toISOString()}]: Successfully refreshed the access_token for Spotify Web API`);
			} catch (error) {
				console.error(`[${new Date().toISOString()}]: ${error.message}`);
				throw new Error('Failed to update the Spotify Web API access_token on MongoDB');
			}
		} else {
			throw new Error('Failed to refresh the access_token for Spotify Web API');
		}
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: Function refreshSpotifyAccessToken() > ${error.message}`);
	}
}

async function setSpotifyAuthorizationTokens() {
	try {
		if (!SPOTIFY_ACCESSTOKEN && !SPOTIFY_ATEXPIRESAT && !SPOTIFY_REFRESHTOKEN) {
			const spotifyAuthorizationData = await mongo.db('spotify').collection('spotify-authorization').findOne();

			if (!spotifyAuthorizationData) {
				throw new Error(`Authorize Spotify Web API at https://${__dirname.split('/').pop()}/authorize`);
			}

			SPOTIFY_ACCESSTOKEN = spotifyAuthorizationData.access_token;
			SPOTIFY_ATEXPIRESAT = spotifyAuthorizationData.access_token_expires_at;
			SPOTIFY_REFRESHTOKEN = spotifyAuthorizationData.refresh_token;

			if (SPOTIFY_ATEXPIRESAT - Date.now() < 300e3) await refreshSpotifyAccessToken();
		} else if (SPOTIFY_ATEXPIRESAT - Date.now() < 300e3) {
			await refreshSpotifyAccessToken();
		}

		setTimeout(setSpotifyAuthorizationTokens, (SPOTIFY_ATEXPIRESAT - Date.now()) - 300e3);
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: Function setSpotifyAuthorizationTokens() > ${error.message}`);
		return setTimeout(setSpotifyAuthorizationTokens, 60e3);
	}
}

await setSpotifyAuthorizationTokens();

async function saveSpotifyPlayerHistory() {
	try {
		const spotifyLastPlayed = await mongo.db('spotify').collection('spotify-player-history').findOne({}, { sort: { timestamp: -1 } });

		if (spotifyLastPlayed === null) {
			try {
				await mongo.db('spotify').collection('spotify-player-history').insertOne({
					item: SPOTIFY_CURRENTLYPLAYING.item,
					timestamp: SPOTIFY_CURRENTLYPLAYING.timestamp
				});
			} catch (error) {
				console.error(`[${new Date().toISOString()}]: ${error.message}`);
				throw new Error(`Failed to save currently playing from Spotify WEB API to MongoDB for spotify-player-history`);
			}
		} else {
			if (SPOTIFY_CURRENTLYPLAYING.item.uri != spotifyLastPlayed.item.uri) {
				console.log(`[${new Date().toISOString()}]: Spotify started playing (${SPOTIFY_CURRENTLYPLAYING.item.external_urls.spotify})`);

				try {
					await mongo.db('spotify').collection('spotify-player-history').insertOne({
						item: SPOTIFY_CURRENTLYPLAYING.item,
						timestamp: SPOTIFY_CURRENTLYPLAYING.timestamp
					});

					wssClients.forEach(async wsClient => {
						if (wsClient.readyState === WebSocket.OPEN) {
							try {
								const spotifyPlayerHistory = await mongo.db('spotify').collection('spotify-player-history').findOne({}, { sort: { timestamp: -1 }, skip: 1 });
								wsClient.send(JSON.stringify({
									type: 'spotify-player-history-update',
									data: spotifyPlayerHistory
								}));
							} catch (error) {
								console.error(`[${new Date().toISOString()}]: ${error.message}`);
							}
						}
					});

				} catch (error) {
					console.error(`[${new Date().toISOString()}]: ${error.message}`);
					throw new Error(`Failed to save currently playing from Spotify WEB API to MongoDB for spotify-player-history`);
				}
			}
		}
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: Function saveSpotifyPlayerHistory() > ${error.message}`);
	}
}

async function setSpotifyCurrentlyPlaying() {
	try {
		const requestOptions = {
			method: 'GET',
			headers: { 'Authorization': `Bearer ${SPOTIFY_ACCESSTOKEN}` }
		};

		const spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', requestOptions);

		if (spotifyResponse.ok && spotifyResponse.status === 200) {
			SPOTIFY_CURRENTLYPLAYING = await spotifyResponse.json();

			wssClients.forEach(async wsClient => {
				if (wsClient.readyState === WebSocket.OPEN) {
					wsClient.send(JSON.stringify({
						type: 'spotify-currently-playing',
						data: SPOTIFY_CURRENTLYPLAYING
					}));
				}
			});

			await saveSpotifyPlayerHistory();
		} else if (spotifyResponse.ok) {
			throw new Error(`Failed to get currently playing from Spotify WEB API (${spotifyResponse.statusText})`);
		}
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: Function setSpotifyCurrentlyPlaying() > ${error.message}`);
		return setTimeout(setSpotifyCurrentlyPlaying, 15e3);
	}

	setTimeout(setSpotifyCurrentlyPlaying, 1e3);
}

await setSpotifyCurrentlyPlaying();

// async function sessionAccessStatus(spotifySessionID, wsClientId) {
// 	try {
// 		const sessionAccessStatus = await mongo.db('spotify').collection('spotify-sessions').findOne({ _id: spotifySessionID });

// 		if (wsClientId) {
// 			const wsClient = wssClients.get(wsClientId);

// 			if (wsClient.readyState === WebSocket.OPEN) {
// 				wsClient.send(JSON.stringify({
// 					type: 'session-access-status',
// 					data: sessionAccessStatus.authorized
// 				}));
// 			}
	
// 		} else {
// 			return sessionAccessStatus.authorized;
// 		}
// 	} catch (error) {
// 		console.error(`[${new Date().toISOString()}]: ${error.message}`);
// 	}
// }

// async function sessionAccessRequest(sessionData, wsClientId) {
// 	try {
// 		await mongo.db('spotify').collection('spotify-sessions').updateOne({ _id: sessionData['spotify-session-id'] }, {
// 			$set: {
// 				alias: sessionData['spotify-session-alias'],
// 				authorized: false
// 			}
// 		}, { upsert: true });
// 	} catch (error) {
// 		console.error(`[${new Date().toISOString()}]: ${error.message}`);
// 	}
// }

// async function sessionAccessToggle(sessionData, wsClientId) {
// 	try {
// 		await mongo.db('spotify').collection('spotify-sessions').updateOne({ _id: sessionData['spotify-session-id'] }, {
// 			$set: {
// 				authorized: sessionData['spotify-session-authorized']
// 			}
// 		}, { upsert: true });

// 		await sessionAccessAdmin(wsClientId);
// 	} catch (error) {
// 		console.error(`[${new Date().toISOString()}]: ${error.message}`);
// 	}
// }

// async function sessionAccessAdmin(wsClientId) {
// 	try {
// 		const sessionAccessRequested = await mongo.db('spotify').collection('spotify-sessions').find({ alias: { $exists: true } }).toArray();

// 		const wsClient = wssClients.get(wsClientId);

// 		if (wsClient.readyState === WebSocket.OPEN) {
// 			wsClient.send(JSON.stringify({
// 				type: 'session-access-requested',
// 				data: sessionAccessRequested
// 			}));
// 		}

// 	} catch (error) {
// 		console.error(`[${new Date().toISOString()}]: ${error.message}`);
// 	}
// }

async function spotifySearchTrack(searchQuery, wsClientId) {
	try {
		const requestOptions = {
			method: 'GET',
			headers: { 'Authorization': `Bearer ${SPOTIFY_ACCESSTOKEN}` }
		};

		const spotifyResponse = await fetch(`https://api.spotify.com/v1/search?q=${searchQuery}&type=track`, requestOptions);

		if (spotifyResponse.ok && spotifyResponse.status === 200) {
			const data = await spotifyResponse.json();

			const wsClient = wssClients.get(wsClientId);

			if (wsClient.readyState === WebSocket.OPEN) {
				wsClient.send(JSON.stringify({
					type: 'spotify-search-track-response',
					data: data.tracks.items
				}));
			}

		} else if (spotifyResponse.ok) {
			throw new Error(`Failed to search tracks from Spotify WEB API (${spotifyResponse.statusText})`);
		}
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: Function spotifySearchTrack() > ${error.message}`);
	}
}

// async function checkAuthorization(req, res, next) {
// 	if (req.url === '/access-admin') {
// 		const headerAuthorization = req.headers.authorization;

// 		if (!headerAuthorization || new Buffer.from(headerAuthorization.split(' ')[1], 'base64').toString().split(':')[1] !== 'password') {
// 			res.setHeader('WWW-Authenticate', 'Basic');
// 			return res.sendStatus(401);
// 		}

// 		next();
// 	} else {
// 		if (await sessionAccessStatus(req.sessionID)) {
// 			return next();
// 		} else {
// 			res.redirect('/access-request');
// 		}
// 	}
// };

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/views/index.html');
});

// app.get('/', checkAuthorization, (req, res) => {
// 	res.sendFile(__dirname + '/views/index.html');
// });

// app.get('/access-request', (req, res) => {
// 	res.sendFile(__dirname + '/views/access-request.html');
// });

// app.get('/access-admin', checkAuthorization, (req, res) => {
// 	res.sendFile(__dirname + '/views/access-admin.html');
// });

app.get('/authorize', (req, res) => {
	const params = new URLSearchParams({
		client_id: SPOTIFY_CLIENTID,
		response_type: 'code',
		redirect_uri: `https://${__dirname.split('/').pop()}/callback`,
		scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played'
	});
	res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

app.get('/callback', async (req, res) => {
	const callbackCode = req.query.code;
	if (callbackCode) {
		try {
			const requestOptions = {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Authorization': 'Basic ' + (new Buffer.from(`${SPOTIFY_CLIENTID}:${SPOTIFY_CLIENTSECRET}`).toString('base64'))
				},
				body: `grant_type=authorization_code&code=${callbackCode}&redirect_uri=https://${__dirname.split('/').pop()}/callback`
			};
			const requestResponse = await fetch('https://accounts.spotify.com/api/token', requestOptions);
			if (requestResponse.ok) {
				const data = await requestResponse.json();
				try {
					await mongo.db('spotify').collection('spotify-authorization').updateOne({}, {
						$set: {
							access_token: data.access_token,
							access_token_expires_at: Date.now() + (data.expires_in * 1e3),
							refresh_token: data.refresh_token
						}
					}, { upsert: true });
					SPOTIFY_ACCESSTOKEN = data.access_token;
					SPOTIFY_REFRESHTOKEN = data.refresh_token;
					res.redirect('/');
				} catch (error) {
					console.error(`[${new Date().toISOString()}]: ${error.message}`);
					throw new Error('Failed to save the access_token and refresh_token from Spotify Web API to MongoDB');
				}
			} else {
				throw new Error('Failed to request the access_token and refresh_token from Spotify Web API');
			}
		} catch (error) {
			console.error(`[${new Date().toISOString()}]: ${error.message}`);
			res.sendStatus(500);
		}
	} else {
		res.sendStatus(401);
	}
});

app.use('/robots.txt', (req, res) => {
	res.type('text/plain');
	res.send('User-agent: *\nDisallow: /');
});