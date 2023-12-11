$(document).ready(function() {
	function connectWebSocket() {
		const ws = new WebSocket(`wss://${window.location.hostname}`);

		ws.addEventListener('open', (event) => {
			console.log('WS Connected!');
			setInterval(() => {
				ws.send(JSON.stringify({ type: 'get-playback-state' }));
			}, 4e3);
		});

		ws.addEventListener('message', (event) => {
			const response = JSON.parse(event.data);
			switch (response.type) {
			case 'get-playback-state':
				// console.log(response.data);
				$('#album-href').attr('href', response.data.item.album.external_urls.spotify);
				$('#album-image').attr('src', response.data.item.album.images[1].url);
				$('#track-href').attr('href', response.data.item.external_urls.spotify);
				$('#track-name').text(response.data.item.name);
				let artists = [];
				for(const artist of response.data.item.artists) {
					artists.push(artist.name);
				}
				$('#track-artists').text(artists.join(', '));
				break;
			case 'get-track':
				console.log(response.data);
				break;
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