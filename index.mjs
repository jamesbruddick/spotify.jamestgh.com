import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { CronJob } from 'cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { PORT, MONGODB, SPOTIFY_CLIENTID, SPOTIFY_CLIENTSECRET } = process.env;
let SPOTIFY_ACCESSTOKEN = '';

const app = express();
const wss = new WebSocketServer({ 
	server: app.listen(PORT, () => { 
		console.log(`[${new Date().toISOString()}]: The NodeJS application (${__dirname.split('/').pop()}) is running on port ${PORT};`) 
	})
});
const mongo = new MongoClient(MONGODB, { serverApi: ServerApiVersion.v1 });

async function setAccessToken() {
	try {
		const spotifyTokens = await mongo.db('Spotify').collection('spotify-tokens').findOne();
		if (spotifyTokens) {
			SPOTIFY_ACCESSTOKEN = spotifyTokens.access_token;
			return;
		} else {
			throw new Error(`authorize spotify web api at https://${__dirname.split('/').pop()}/login`);
		}
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: ${error.message}`);
	}
}

await setAccessToken();

function generateRandomId(length) {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
}

const wssClients = new Set();

let spotifyCurrentlyPlaying;

async function getSpotifyData(spotifyUrl, requestType, accessToken) {
	const requestOptions = { method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` } };
	try {
		const spotifyResponse = await fetch(spotifyUrl, requestOptions);
		if (spotifyResponse.status === 200) {
			const spotifyJson = await spotifyResponse.json();
			switch (requestType) {
				case 'spotify-recently-played-tracks':
					await mongo.db('Spotify').collection(requestType).updateOne({ played_at: spotifyJson.items[0].played_at }, { $set: spotifyJson.items[0] }, { upsert: true });
					break;
				// case 'get-track':
				// 	await mongo.db('Spotify').collection(requestType).insertOne(spotifyJson);
				// 	break;
			}
			return spotifyJson;
		} else {
			throw new Error(`${requestType} using function getSpotifyData() with spotify-web-api errored with status code ${requestResponse.status}`);
		}
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: ${error.message}`);
		return { status: 'error', message: error.message };
	}
}

setInterval(async () => {
	try {
		const spotifyResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { method: 'GET', headers: { 'Authorization': `Bearer ${SPOTIFY_ACCESSTOKEN}` } });
		if (!spotifyResponse.ok) throw new Error(`spotify-web-api errored with status code ${spotifyResponse.status}`);
		const spotifyData = await spotifyResponse.json();
		try {
			await mongo.db('Spotify').collection('spotify-currently-playing').updateOne({}, { $set: spotifyData }, { upsert: true });
		} catch (error) {
			throw error;
		}
		if (spotifyCurrentlyPlaying === undefined) spotifyCurrentlyPlaying = spotifyData;
		if (spotifyData.timestamp !== spotifyCurrentlyPlaying.timestamp) {
			spotifyCurrentlyPlaying = spotifyData;
			try {
				await getSpotifyData('https://api.spotify.com/v1/me/player/recently-played?limit=1', 'spotify-recently-played-tracks', SPOTIFY_ACCESSTOKEN);
			} catch (error) {
				throw error;
			}
			wssClients.forEach(async wsClient => {
				if (wsClient.readyState === WebSocket.OPEN) {
					wsClient.send(JSON.stringify({ type: 'spotify-currently-playing', data: spotifyData }));
					wsClient.send(JSON.stringify({ type: 'spotify-recently-played-tracks', data: await mongo.db('Spotify').collection('spotify-recently-played-tracks').find({}).sort({ played_at: -1 }).toArray() }));
				}
			});
		}
	} catch (error) {
		try {
			await mongo.db('Spotify').collection('spotify-currently-playing').updateOne({}, { $set: { is_playing: false } }, { upsert: true });
		} catch (error) {
			console.error(`[${new Date().toISOString()}]: ${error.message}`);
		}
		wssClients.forEach(async wsClient => {
			if (wsClient.readyState === WebSocket.OPEN) {
				wsClient.send(JSON.stringify({ type: 'spotify-currently-playing', data: await mongo.db('Spotify').collection('spotify-currently-playing').findOne() }));
			}
		});
		if (!error.message.includes('Unexpected end of JSON input')) console.error(`[${new Date().toISOString()}]: ${error.message}`);
	}
}, 1000);

wss.on('connection', async (ws, req) => {
	wssClients.add(ws);
	const wssClientId = generateRandomId(16);
	const wssClientIp = req.headers['x-forwarded-for'].split(',')[0].trim();

	console.log(`[${new Date().toISOString()}]: ${wssClientIp} websocket client (${wssClientId}) connected`);

	setInterval(() => {
		if (ws.readyState === WebSocket.OPEN) ws.ping();
	}, 2e4);

	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: 'spotify-currently-playing', data: await mongo.db('Spotify').collection('spotify-currently-playing').findOne() }));
		ws.send(JSON.stringify({ type: 'spotify-recently-played-tracks', data: await mongo.db('Spotify').collection('spotify-recently-played-tracks').find({}).sort({ played_at: -1 }).toArray() }));
	}

	ws.on('message', async (message) => {
		const request = JSON.parse(message);
		switch (request.type) {
			// case 'get-track':
			// 	const mongoTrack = await mongo.db('Spotify').collection(request.type).findOne({ id: request.data });
			// 	if (mongoTrack) {
			// 		console.log(`[${new Date().toISOString()}]: ${wssClientIp} websocket client (${wssClientId}) is requesting ${request.type} from mongodb-cache`);
			// 		ws.send(JSON.stringify({ type: request.type, data: mongoTrack }));
			// 	} else {
			// 		console.log(`[${new Date().toISOString()}]: ${wssClientIp} websocket client (${wssClientId}) is requesting ${request.type} from spotify-web-api`);
			// 		ws.send(JSON.stringify({ type: request.type, data: await getSpotifyData(`https://api.spotify.com/v1/tracks/${request.data}`, request.type, SPOTIFY_ACCESSTOKEN) }));
			// 	}
			// 	break;
		}
	});

	ws.on('close', () => {
		wssClients.delete(ws);
		console.log(`[${new Date().toISOString()}]: ${wssClientIp} websocket client (${wssClientId}) disconnected`);
	});
});

wss.on('error', (error) => {
	console.error(`[${new Date().toISOString()}]: ${error.message}`);
});

app.locals.pretty = true;
app.set('trust proxy', true);
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.disable('x-powered-by');

app.get('/', async (req, res) => {
	if (SPOTIFY_ACCESSTOKEN) {
		res.sendFile(__dirname + '/views/index.html');
	} else {
		res.sendStatus(500);
	}
});

app.get('/login', (req, res) => {
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
		const requestOptions = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Authorization': 'Basic ' + (new Buffer.from(`${SPOTIFY_CLIENTID}:${SPOTIFY_CLIENTSECRET}`).toString('base64'))
			},
			body: `grant_type=authorization_code&code=${callbackCode}&redirect_uri=https://${__dirname.split('/').pop()}/callback`
		};
		try {
			const requestResponse = await fetch('https://accounts.spotify.com/api/token', requestOptions);
			if (requestResponse.ok) {
				const data = await requestResponse.json();
				await mongo.db('Spotify').collection('spotify-tokens').updateOne({}, {
					$set: {
						access_token: data.access_token,
						refresh_token: data.refresh_token
					}
				}, { upsert: true });
				await setAccessToken();
				res.redirect('/');
			} else {
				throw new Error('failed to request the access_token from spotify-web-api');
			}
		} catch (error) {
			console.error(`[${new Date().toISOString()}]: ${error.message}`);
			res.sendStatus(500);
		}
	} else {
		res.redirect('/login');
	}
});

app.use('/robots.txt', (req, res) => {
	res.type('text/plain');
	res.send('User-agent: *\nDisallow: /');
});

process.on('SIGINT', () => {
	console.log(`[${new Date().toISOString()}]: The NodeJS application (${__dirname.split('/').pop()}) on port ${PORT} is being shutdown from SIGINT (Ctrl-C);`);
	process.exit(0);
});

new CronJob('*/5 * * * *', async () => {
	try {
		const spotifyTokens = await mongo.db('Spotify').collection('spotify-tokens').findOne();
		if (spotifyTokens) {
			const requestOptions = {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Authorization': 'Basic ' + (new Buffer.from(`${SPOTIFY_CLIENTID}:${SPOTIFY_CLIENTSECRET}`).toString('base64'))
				},
				body: `grant_type=refresh_token&refresh_token=${spotifyTokens.refresh_token}`
			};
			try {
				const requestResponse = await fetch('https://accounts.spotify.com/api/token', requestOptions);
				if (requestResponse.ok) {
					const data = await requestResponse.json();
					await mongo.db('Spotify').collection('spotify-tokens').updateOne({}, {
						$set: {
							access_token: data.access_token
						}
					}, { upsert: true });
					await setAccessToken();
					console.log(`[${new Date().toISOString()}]: successfully refreshed the access_token for spotify-web-api`);
				} else {
					throw new Error('failed to refresh the access_token for spotify-web-api');
				}
			} catch (error) {
				console.error(`[${new Date().toISOString()}]: ${error.message}`);
			}
		} else {
			throw new Error(`authorize spotify-web-api at https://${__dirname.split('/').pop()}/login`);
		}
	} catch (error) {
		console.error(`[${new Date().toISOString()}]: ${error.message}`);
	}
}).start();