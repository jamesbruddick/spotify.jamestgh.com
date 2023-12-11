const socket = new WebSocket(`wss://${window.location.hostname}`);

socket.addEventListener('open', (event) => {
	console.log('WS Connected!');
	socket.send(JSON.stringify({ type: 'get-playback-state' }));
});

socket.addEventListener('message', (event) => {
	const response = JSON.parse(event.data);
	switch (response.type) {
		case 'get-playback-state':
			console.log(response.data);
			break;
	}
});

socket.addEventListener('close', (event) => {
	console.log('WS Disconnected!');
});