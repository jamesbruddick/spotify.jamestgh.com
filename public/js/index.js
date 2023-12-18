$(document).ready(function() {
	let ws, refreshTimeout, playbackTrackProgress;

	function msToMinSec(ms) {
		const msToSec = ms / 1000;
		const seconds = Math.floor(msToSec % 60);
		return `${Math.floor(msToSec / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
	}
	
	function displayCurrentlyPlaying(data) {
		let trackProgress = data.progress_ms;

		if (playbackTrackProgress) {
			clearInterval(playbackTrackProgress);
			playbackTrackProgress = null;
		}

		const updateTrackProgress = () => {
			const progressPercentage = Math.round((trackProgress / data.item.duration_ms) * 100);
			$('#track-progress').attr('aria-valuenow', progressPercentage).css('width', `${progressPercentage}%`);
		
			const trackTimeText = `${msToMinSec(trackProgress)} / ${msToMinSec(data.item.duration_ms)}`;
			$('#track-time').text(trackTimeText);
		};
		
		if (data.is_playing) {
			playbackTrackProgress = setInterval(() => {
				trackProgress += 10;
				updateTrackProgress();
			}, 10);
		} else {
			updateTrackProgress();
		}
		
		$('#album-image').attr('src', data.item.album.images[1].url);
		$('#track-name > a').attr('href', data.item.external_urls.spotify).text(data.item.name);
		$("#track-artists").html(data.item.artists.map(artist => `<a href="${artist.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${artist.name}</a>`).join(', '));
	}

	// function displayRecentlyPlayed(data) {
	// 	$("#recently-played > tr").remove();
	// 	data.forEach(track => {
	// 		$('#recently-played').append($('<tr>').append(`
	// 			<td>${(new Date(track.played_at)).toLocaleString()}</td>
	// 			<td><a href="${track.track.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${track.track.name}</a></td>
	// 			<td>${track.track.artists.map(artist => `<a href="${artist.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${artist.name}</a>`).join(', ')}</td>
	// 			<td><a href="${track.track.album.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${track.track.album.name}</a></td>
	// 		`));
	// 	});
	// }

	function connectWebSocket() {
		ws = new WebSocket(`wss://${window.location.hostname}`);

		ws.addEventListener('open', (event) => {
			// console.log('WS Connected!');
		});

		ws.addEventListener('message', (event) => {
			const response = JSON.parse(event.data);
				switch (response.type) {
					case 'spotify-currently-playing':
						displayCurrentlyPlaying(response.data);
						break;
					// case 'spotify-recently-played-tracks':
					// 	displayRecentlyPlayed(response.data);
					// 	break;
				}
		});

		ws.addEventListener('error', (event) => {
			console.error('WS Error!');
		});

		ws.addEventListener('close', (event) => {
			// console.log('WS Disconnected! Attempting to reconnect...');
			clearTimeout(refreshTimeout);
			setTimeout(connectWebSocket, 4e3);
		});
	}

	connectWebSocket();
});