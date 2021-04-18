let resocial = {
	options: {
		jitsi: {
			disableAudioLevels: true,
		},
		connection: {
			hosts: {
				domain: 'beta.meet.jit.si',
				muc: 'conference.beta.meet.jit.si'
			},
			serviceUrl: 'wss://beta.meet.jit.si/xmpp-websocket',
			clientNode: 'https://beta.meet.jit.si',
		},
		room: {
			ID: null,
			openBridgeChannel: true,
		},
		autoConnectToRoom: true,
		threadInterval: 5000,
	},
	
	connection: null,
	room: null,
	joinedRoom: false,
	localTracks: [],
	remoteTracks: [],
	threadTimer: null,
	
	/*I don't like the track structure, I would rather have
	
		track[userID].video
		track[userID].audio
		track[userID].screen
	
	*/
	
	/**
	* Initiates Resocial app
	* @param addedOptions Object to replace default options
	*/
	init: function(addedOptions) {
		if(typeof(addedOptions) != 'undefined') {
			Object.assign(this.options, addedOptions);
		}
		
		//Generate a hashed room idea for now:
		var plainText = new Date().toISOString().substring(0,10);
		var hash = CryptoJS.MD5(plainText).toString();
		this.options.room.ID = hash;
		
		this.initJitsi();
		this.initLocalDevices();
	},
	
	/**
	* Initiates Jitsi connection
	*/
	initJitsi: function () {
		console.log("resocial.initJitsi()");
		JitsiMeetJS.init(this.options.jitsi);
		this.connection = new JitsiMeetJS.JitsiConnection(null, null, this.options.connection);
		
		//Add event listeners for connection
		this.connection.addEventListener(
			JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
			resocial.onConnectionEvent.connected);
		this.connection.addEventListener(
			JitsiMeetJS.events.connection.CONNECTION_FAILED,
			resocial.onConnectionEvent.failed);
		this.connection.addEventListener(
			JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
			resocial.onConnectionEvent.disconnected);

		//Add event listener for media
		JitsiMeetJS.mediaDevices.addEventListener(
			JitsiMeetJS.events.mediaDevices.DEVICE_LIST_CHANGED,
			resocial.onMediaEvent.devicesChanged);
			
		//Connect to server, but don't connect to a room yet.
		this.connection.connect(); 
	},
	
	initLocalDevices: function () {
		console.log("resocial.initLocalDevices()");
		JitsiMeetJS.createLocalTracks({ devices: [ 'audio', 'video' ] })
			.then(resocial.roomControl.addLocalTracks)
			.catch(error => {
				throw error;
			});
	},
	

	
	
	/**
	* Functions for controlling room
	*/
	roomControl: {
		
		/**
		* Initiates a connection to the specified room and password
		* @param roomId Room ID to connect to. Otherwise uses default
		*/
		connect: function(roomID) {
			console.log("resocial.roomControl.connect()");
			if(typeof(roomID) != 'undefined') {
				resocial.options.room.ID = roomID;
			}
			
			console.log("Room ID: " + resocial.options.room.ID);
			
			resocial.room = resocial.connection.initJitsiConference(
				resocial.options.room.ID, 
				resocial.options.room,
			);
			
			resocial.room.on(
				JitsiMeetJS.events.conference.TRACK_ADDED, 
				resocial.onRoomEvent.trackAdded
			);
			resocial.room.on(
				JitsiMeetJS.events.conference.TRACK_REMOVED, 
				resocial.onRoomEvent.trackRemoved
			);
			resocial.room.on(
				JitsiMeetJS.events.conference.CONFERENCE_JOINED,
				resocial.onRoomEvent.joinedRoom
			);
			resocial.room.on(
				JitsiMeetJS.events.conference.USER_JOINED, 
				resocial.onRoomEvent.userJoined
			);
			resocial.room.on(
				JitsiMeetJS.events.conference.USER_LEFT, 
				resocial.onRoomEvent.userLeft
			);
			
			resocial.room.addCommandListener("RESOCIAL_DATA", 
				resocial.onRoomEvent.resocialData,
			);
			
			//Initiate data sending
			
			resocial.threadTimer = window.setInterval(
				resocial.mainThread,
				resocial.options.threadInterval,
			);
			
			resocial.room.join();
		},
		
		addRemoteTrack: function(track) {
			console.log("resocial.roomControl.addRemoteTrack()", track);
			if (track.isLocal()) {
				return;
			}
			
			const userID = track.getParticipantId();

			if (!resocial.remoteTracks[userID]) {
				resocial.remoteTracks[userID] = [];
			}
			const trackNumber = resocial.remoteTracks[userID].push(track);
			const trackID = userID + track.getType() + trackNumber;

			if (track.getType() === 'video') {
			$('body').append(
				`<video autoplay='1' id='${trackID}' />`);
			} else {
			$('body').append(
				`<audio autoplay='1' id='${trackID}' />`);
			}
			track.attach($(`#${trackID}`)[0]);
		},
		removeRemoteTrack: function(userID, trackNumber) {
			var track = resocial.remoteTracks[userID][trackNumber];
			const trackID = userID + track.getType() + trackNumber;
			track.detach($("#" + trackID));
			track.dispose();
			$("#" + trackID).remove();
			
		},
		addLocalTracks: function(tracks) {
			console.log("resocial.roomControl.addLocalTrack()");
			resocial.localTracks = tracks;
			for (let i = 0; i < resocial.localTracks.length; i++) {
				if (resocial.localTracks[i].getType() === 'video') {
					$('body').append(`<video autoplay='1' id='localVideo${i}' />`);
					resocial.localTracks[i].attach($(`#localVideo${i}`)[0]);
				} else {
					$('body').append(
						`<audio autoplay='1' muted='true' id='localAudio${i}' />`);
					resocial.localTracks[i].attach($(`#localAudio${i}`)[0]);
				}
				if (resocial.joinedRoom) {
					//Connection to room happened before devices initialized, add now
					resocial.room.addTrack(resocial.localTracks[i]);
				}
			}
		},
		sendResocialData: function() {
			resocial.room.sendCommand("RESOCIAL_DATA",
				{
					value: "Test Data: " + new Date().toString() + navigator.userAgent,
				}
			);
		},
	},
	
	/**
	* Function continually called to update frame/send data.
	*/
	mainThread: function() {
		resocial.roomControl.sendResocialData();
	},

	/**
	* Terminates all connections and unloads tracks
	*/
	close: function () {
		for (var track of resocial.localTracks) {
			track.dispose();
		}
		
		if(resocial.joinedRoom) {
			resocial.room.leave();
		}
		resocial.connection.disconnect();
		window.clearInterval(resocial.threadTimer);
	},
	
	/**
	* Callback functions for connection events
	*/
	onConnectionEvent: {
		connected: function() {
			console.log("resocial.onConnectionEvent.connected()");
			if(resocial.options.autoConnectToRoom) {
				resocial.roomControl.connect();
			}
		},
		failed: function() {
			
		},
		disconnected: function() {
			
		},
		
	},
	
	/**
	* Callback functions for media events
	*/
	onMediaEvent: {
		devicesChanged: function() {
			
		},
	},
	
	/**
	* Callback functions for room events
	*/
	onRoomEvent: {
		trackAdded: function(track) {
			resocial.roomControl.addRemoteTrack(track);
		},
		trackRemoved: function(track) {
			//resocial.roomControl.removeRemoteTrack(track);
		},
		joinedRoom: function() {
			console.log("resocial.onRoomEvent.joinedRoom()");
			resocial.joinedRoom = true;
			//if local tracks initialized before we connected
			for (let i = 0; i < resocial.localTracks.length; i++) {
				resocial.room.addTrack(resocial.localTracks[i]);
			}
		},
		userJoined: function() {
			
		},
		userLeft: function(userID) {
			//any tracks from that user? 
			if(!resocial.remoteTracks[userID]) {
				return;
			}
			
			const tracks = resocial.remoteTracks[userID];
			for (let i = 0; i < tracks.length; i++) {
				resocial.roomControl.removeRemoteTrack(userID, i);
			}
			
		},
		resocialData: (data) => {
			console.log("Messaged received: ", data);
		},
	},
	
	
}


//start