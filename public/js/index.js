$(document).ready(function() {
	let ws, refreshTimeout;

	function msToMinSec(ms) {
		const seconds = Math.floor(ms / 1000), remainingSeconds = seconds % 60;
		return `${Math.floor(seconds / 60)}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
	}

	function getPlaybackState(interval) {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'get-playback-state' }));
		refreshTimeout = setTimeout(() => getPlaybackState(interval), interval);
	}
	
	function displayPlaybackState(data) {
		$('#album-href').attr('href', data.item.album.external_urls.spotify);
		$('#album-image').attr('src', data.item.album.images[1].url);
		$('#track-href').attr('href', data.item.external_urls.spotify);
		$('#track-name').text(data.item.name);
		$('#track-artists').text(data.item.artists.map(artist => artist.name).join(', '));
		$('#track-time').text(`${msToMinSec(data.progress_ms)}/${msToMinSec(data.item.duration_ms)}`)
	}

	function connectWebSocket() {
		ws = new WebSocket(`wss://${window.location.hostname}`);

		ws.addEventListener('open', (event) => {
			console.log('WS Connected!');
			getPlaybackState(1e3);
		});

		ws.addEventListener('message', (event) => {
			const response = JSON.parse(event.data);
			if (response.data.status !== 'error') {
				switch (response.type) {
					case 'get-playback-state':
						console.log(response.data);
						displayPlaybackState(response.data);
						break;
					case 'get-track':
						console.log(response.data);
						break;
				}
			} else {
				console.error(response.data.message);
			}
		});

		ws.addEventListener('error', (event) => {
			console.error('WS Error!');
		});

		ws.addEventListener('close', (event) => {
			console.log('WS Disconnected! Attempting to reconnect...');
			clearTimeout(refreshTimeout);
			setTimeout(connectWebSocket, 4e3);
		});
	}

	connectWebSocket();
});