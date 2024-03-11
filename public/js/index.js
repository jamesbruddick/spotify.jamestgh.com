$(document).ready(function() {

	let ws, wsClientId, refreshTimeout, playbackTrackProgress;
	// const spotifySessionID = Cookies.get('spotify-sid').split(':')[1].split('.')[0];

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
			const progressPercentage = (trackProgress / data.item.duration_ms) * 100;
			$('#currently-playing-progress').attr('aria-valuenow', progressPercentage.toFixed(2)).css('width', `${progressPercentage.toFixed(2)}%`);
			$('#currently-playing-track-time').text(`${msToMinSec(trackProgress)} / ${msToMinSec(data.item.duration_ms)}`);
		};

		if (data.is_playing) {
			playbackTrackProgress = setInterval(() => {
				trackProgress += 1000;
				updateTrackProgress();
			}, 1000);
		} else {
			updateTrackProgress();
		}

		$('#background-image').css({ 'background': `url(${data.item.album.images[1].url}) center/cover no-repeat` });
		$('#currently-playing-album-image').attr('src', data.item.album.images[1].url);
		$('#currently-playing-track-name > span').text(data.item.name);
		$("#currently-playing-track-artists").html(data.item.artists.map(artist => `<a href="${artist.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${artist.name}</a>`).join(', '));

		if ($('#currently-playing-track-name > span').width() > $('#currently-playing-track-info').width()) {
			$('#currently-playing-track-name').addClass('scroll-text');
		} else {
			$('#currently-playing-track-name').removeClass('scroll-text');
		}
	}


	function displayPlayerHistory(data) {

		$('#recently-played').empty();

		data.forEach(track => {
			$('#recently-played').append(`
				<div id="recently-played-track-card" class="card mb-1">
					<div class="card-body d-flex align-items-center p-0">
						<img class="img-fluid" src="${track.item.album.images[1].url}" alt="Album Image" width="75px" height="75px">
						<div class="flex-grow-1 mx-2">
							<div id="recently-played-track-name" class="lh-sm"><a href="${track.item.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${track.item.name}</a></div>
							<div id="recently-played-track-artists">${track.item.artists.map(artist => `<a href="${artist.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${artist.name}</a>`).join(', ')}</div>
						</div>
					</div>
				</div>
			`);
		});
	}

	function displayPlayerHistoryUpdate(data) {
		$('#recently-played div#recently-played-track-card:last').remove();

		$('#recently-played').prepend(`
			<div id="recently-played-track-card" class="card mb-1">
				<div class="card-body d-flex align-items-center p-0">
					<img class="img-fluid" src="${data.item.album.images[1].url}" alt="Album Image" width="75px" height="75px">
					<div class="flex-grow-1 mx-2">
						<div id="recently-played-track-name" class="lh-sm"><a href="${data.item.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${data.item.name}</a></div>
						<div id="recently-played-track-artists">${data.item.artists.map(artist => `<a href="${artist.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${artist.name}</a>`).join(', ')}</div>
					</div>
				</div>
			</div>
		`);
	}

	function displaySpotifySearch(data) {
		$('#spotify-search-track-results').empty();

		data.forEach(track => {
			$('#spotify-search-track-results').append(`
				<div id="spotify-search-track-card" class="card mb-1">
					<div id="spotify-search-track-card-body" class="card-body d-flex align-items-center p-0"">
						<img id="spotify-search-album-image" class="img-fluid" src="${track.album.images[1].url}" alt="Album Image" width="75px" height="75px">
						<div id="spotify-search-track-info" class="flex-grow-1 mx-2">
							<div id="spotify-search-track-name" class="mw-70 lh-sm"><a href="${track.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${track.name}</a></div>
							<div id="spotify-search-track-artists">${track.artists.map(artist => `<a href="${artist.external_urls.spotify}" target="_blank" class="text-reset text-decoration-none">${artist.name}</a>`).join(', ')}</div>
						</div>
						<button id="spotify-search-queue-button" class="btn me-3" type="button">Queue</button>
					</div>
				</div>
			`);
		});
	}

	$('#search-track-button, #search-track-input').on('click keypress', function(event) {
		if (event.which === 13 || event.type === 'click') {
			ws.send(JSON.stringify({
				type: 'spotify-search-track',
				data: $("#search-track-input").val(),
				wsid: wsClientId
			}));
		}
	});

	// setInterval(() => {
	// 	ws.send(JSON.stringify({
	// 		type: 'session-access-status',
	// 		data: spotifySessionID,
	// 		wsid: wsClientId
	// 	}));
	// }, 4e3);

	function connectWebSocket() {
		ws = new WebSocket(`wss://${window.location.hostname}`);

		ws.addEventListener('open', (event) => {
			// console.log('WS Connected!');
		});

		ws.addEventListener('message', (event) => {
			const response = JSON.parse(event.data);
			switch (response.type) {
				case 'ws-client-id':
					wsClientId = response.data;
					// console.log('WS Client ID: ', wsClientId);
					break;
				// case 'session-access-status':
				// 	if (response.data === false) window.location.href = '/';
				// 	break;
				case 'spotify-currently-playing':
					displayCurrentlyPlaying(response.data);
					break;
				case 'spotify-player-history':
					displayPlayerHistory(response.data);
					break;
				case 'spotify-player-history-update':
					displayPlayerHistoryUpdate(response.data);
					break;
				case 'spotify-search-track-response':
					displaySpotifySearch(response.data);
					break;
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