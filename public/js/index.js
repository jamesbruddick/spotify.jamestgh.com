function getPlaybackState(refreshInterval) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'get-playback-state' }));
	setTimeout(() => {
		getPlaybackState(refreshInterval);
	}, refreshInterval);
}

function displayPlaybackState(data) {
	$('#album-href').attr('href', data.item.album.external_urls.spotify);
	$('#album-image').attr('src', data.item.album.images[1].url);
	$('#track-href').attr('href', data.item.external_urls.spotify);
	$('#track-name').text(data.item.name);
	let artists = [];
	for(const artist of data.item.artists) {
		artists.push(artist.name);
	}
	$('#track-artists').text(artists.join(', '));
}

$(document).ready(function() {
	function connectWebSocket() {
		ws = new WebSocket(`wss://${window.location.hostname}`);

		ws.addEventListener('open', (event) => {
			console.log('WS Connected!');
			getPlaybackState(4e3);
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

		ws.addEventListener('close', (event) => {
			console.log('WS Disconnected! Attempting to reconnect...');
			setTimeout(() => {
				connectWebSocket();
			}, 4e3);
		});
	}

	connectWebSocket();
});