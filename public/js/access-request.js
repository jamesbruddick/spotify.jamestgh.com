$(document).ready(function() {

	let ws, wsClientId, refreshTimeout
	const spotifySessionID = Cookies.get('spotify-sid').split(':')[1].split('.')[0];

	$('#spotify-access-form').submit(function(event) {
		event.preventDefault();

		ws.send(JSON.stringify({
			type: 'session-access-request',
			data: { 'spotify-session-id': spotifySessionID, 'spotify-session-alias': $('#spotify-access-alias').val() },
			wsid: wsClientId
		}));

		$('#spotify-access-title').text('Request Pending');
		$('#spotify-access-form').hide();

		setInterval(() => {
			ws.send(JSON.stringify({
				type: 'session-access-status',
				data: spotifySessionID,
				wsid: wsClientId
			}));
		}, 4e3);
	});

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
					break;
				case 'spotify-currently-playing':
					$('#background-image').css({ 'background': `url(${response.data.item.album.images[1].url}) center/cover no-repeat` });
					break;
				case 'session-access-status':
					if (response.data === true) window.location.href = '/';
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