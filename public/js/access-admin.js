$(document).ready(function() {

	let ws, wsClientId, refreshTimeout

	function requestSessionAccessAdmin(wsClientId) {
		setTimeout(() => {
			ws.send(JSON.stringify({
				type: 'session-access-admin',
				wsid: wsClientId
			}));
		}, 100);
	}

	function displaySessionAccessRequested(data) {
		$('#session-access-requested').empty();

		data.forEach(session => {
			if (!session.authorized) {
				$('#session-access-requested').append($('<tr>').append(`
					<td>${session.alias}</td>
					<td><button id="session-access-toggle" class="btn px-1 py-0" type="button" data-value="${session._id}" data-bool="true">Accept</button></td>
				`));
			} else {
				$('#session-access-requested').append($('<tr>').append(`
					<td>${session.alias}</td>
					<td><button id="session-access-toggle" class="btn px-1 py-0" type="button" style="background-color: #ff0000 !important;" data-value="${session._id}" data-bool="false">Deny</button></td>
				`));
			} 
		});
	}

	$('#session-access-requested').on('click', 'button', function() {
		ws.send(JSON.stringify({
			type: 'session-access-toggle',
			data: { 'spotify-session-id': $(this).data('value'), 'spotify-session-authorized': $(this).data('bool') },
			wsid: wsClientId
		}));
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
					requestSessionAccessAdmin(wsClientId);
					break;
				case 'session-access-requested':
					displaySessionAccessRequested(response.data);
					break;
				case 'spotify-currently-playing':
					$('#background-image').css({ 'background': `url(${response.data.item.album.images[1].url}) center/cover no-repeat` });
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