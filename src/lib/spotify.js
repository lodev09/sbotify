// https://github.com/spotify/web-api/issues/321
// auth request:
// https://accounts.spotify.com/authorize?client_id=933adf0420af4eecb7d70cc8c7687d70&response_type=code&redirect_uri=https%3A%2F%2Fwww.lodev09.com%2Fspotify%2Fcallback&scope=user-read-playback-state+user-modify-playback-state+playlist-read-private+playlist-modify-public+user-library-read+user-read-private+user-read-email+user-follow-modify+playlist-read-collaborative+playlist-modify-private+user-library-modify+user-read-birthdate+user-follow-read+user-top-read

import request from 'request';

class Spotify {

    constructor(tokenData, userData) {
        this.tokenData = tokenData;
        this.userData = userData;
    }

    static requestOk(response) {
        return response.statusCode === 200 || response.statusCode === 201 || response.statusCode === 204;
    }

    static initToken(authCode) {
        return new Promise((resolve, reject) => {

            const options = {
                url: 'https://accounts.spotify.com/api/token',
                    headers: {
                    'Authorization': 'Basic ' + (Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'))
                },
                form: {
                    'grant_type': 'authorization_code',
                    'code': authCode,
                    'redirect_uri': process.env.SPOTIFY_REDIRECT_URI
                },
                json: true
            };

            request.post(options, (error, response, body) => {
                if (!error && Spotify.requestOk(response)) {
                    resolve(Spotify.createToken(body));
                } else {
                    reject(response.statusCode)
                }
            });
        });
    }

    static createToken(body) {
        return {
            refreshToken: body.refresh_token,
            accessToken: body.access_token,
            expiry: (Date.now() / 1000) + body.expires_in
        }
    }

    getAccessToken() {
        return new Promise((resolve, reject) => {
            if (!this.tokenData) {
                reject('authorization code not valid');
                return;
            }

            // check if access token has expired - refresh if it does
            if (Date.now() / 1000 >= this.tokenData.expiry) {
                const options = {
                    url: 'https://accounts.spotify.com/api/token',
                        headers: {
                        'Authorization': 'Basic ' + (Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'))
                    },
                    form: {
                        'grant_type': 'refresh_token',
                        'refresh_token': this.tokenData.refreshToken

                    },
                    json: true
                };

                request.post(options, (error, response, body) => {
                    if (!error && Spotify.requestOk(response)) {
                        this.tokenData = Spotify.createToken(body);
                        resolve(body.access_token);
                    } else {
                        reject(response.statusCode)
                    }
                });

            } else {
                resolve(this.tokenData.accessToken);
                return;
            }
        })
    }

    post(endPoint, body) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    headers: { 'Authorization': 'Bearer ' + token },
                    json: true
                };

                if (body) options.body = body;

                console.log('POST: ' + endPoint, body);

                request.post(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true);
                    } else {
                        reject(response.statusCode);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    put(endPoint, body) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    headers: { 'Authorization': 'Bearer ' + token },
                    json: true
                };

                if (body) options.body = body;

                console.log('PUT: ' + endPoint, body);

                request.put(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true || true);
                    } else {
                        console.log(body);
                        reject(response.statusCode);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    delete(endPoint, body) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    headers: { 'Authorization': 'Bearer ' + token },
                    json: true
                };

                if (body) options.body = body;

                console.log('DELETE: ' + endPoint, body);

                request.delete(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true || true);
                    } else {
                        reject(response.statusCode);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    get(endPoint, data = null) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    headers: {
                        'Authorization': 'Bearer ' + token
                    },
                    json: true
                };

                if (data) {
                    options.qs = data;
                }

                console.log('GET: ' + endPoint);

                request.get(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true);
                    } else {
                        reject(response.statusCode);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    async init() {
        try {
            var userData = await this.getUserData();

            var botPlaylist = null;
            var playlistData = await this.getPlaylists();

            if (playlistData) {
                playlistData.forEach((playlist) => {
                    if (playlist.owner.id === userData.id && playlist.name === process.env.SPOTIFY_QUEUE_PLAYLIST_NAME) {
                        botPlaylist = playlist;
                    }
                })
            }

            return { userData, playlist: botPlaylist };
        } catch (err) {
            console.log(err);
        }
    }

    async getUserData() {
        try {
            return await this.get('/me');
        } catch (err) {
            console.log(err);
        }
    }

    async search(query, type = 'track', limit = 10) {
        try {
            console.log('searching for "' + query + '"');
            const data = await this.get('/search', {
                q: query,
                type,
                limit
            });

            if (data && data.tracks.items.length > 0) {
                return data.tracks.items;
            } else return null;

        } catch (err) {
            console.log(err)
        }
    }

    async play(uri = null, deviceId = null, playlistUri = null) {
        try {
            var options = null;
            if (uri || playlistUri) {
                options = {};

                // if (uri) options.uris = [ uri ];
                if (playlistUri) options.context_uri = playlistUri;
                if (uri) options.offset = { uri };
            }

            return await this.put('/me/player/play' + (deviceId ? '?device_id=' + deviceId : ''), options);
        } catch (err) {
            console.log(err);
        }
    }

    async getDevices() {
        try {
            var data = await this.get('/me/player/devices');
            return data && data.devices;
        } catch (err) {
            console.log(err);
        }
    }

    async setDevice(deviceId, play = true) {
        try {
            return await this.put('/me/player', {
                device_ids: [ deviceId ],
                play
            });
        } catch (err) {
            console.log(err);
        }
    }

    async getCurrentTrack() {
        try {
            var data = await this.get('/me/player/currently-playing');
            return data && data.item;
        } catch (err) {
            console.log(err)
        }
    }

    async getCurrentPlayback() {
        try {
            return await this.get('/me/player');
        } catch (err) {
            console.log(err);
        }
    }

    async browsePlaylists() {
        try {
            var data = await this.get('/browse/featured-playlists');
            return data && data.playlists.items;
        } catch (err) {
            console.log(err);
        }
    }

    async getPlaylists() {
        try {
            var data = await this.get('/me/playlists');
            return data && data.items;
        } catch (err) {
            console.log(err)
        }
    }

    async createPlaylist(name) {
        try {
            return await this.post('/users/'+this.userData.id+'/playlists', {
                description: 'playlist created by bot',
                public: false,
                name
            });
        } catch (err) {
            console.log(err)
        }
    }

    async getPlaylistTracks(playlistId) {
        try {
            var data = await this.get('/users/'+this.userData.id+'/playlists/'+playlistId+'/tracks');
            return data && data.items.map(item => item.track);
        } catch (err) {
            console.log(err);
        }
    }

    async addTrackToPlaylist(uri, playlistId) {
        try {
            var currentTracks = await this.getPlaylistTracks(playlistId);
            for (var i in currentTracks) {
                var track = currentTracks[i];
                if (track.uri === uri) {
                    console.log('addTrackToPlaylist: existing track');
                    return true;
                }
            }

            return await this.post('/users/'+this.userData.id+'/playlists/'+playlistId+'/tracks', {
                uris: [ uri ]
            });
        } catch (err) {
            console.log(err);
        }
    }

    async clearPlaylist(playlistId) {
        try {
            var tracksData = await this.getPlaylistTracks(playlistId);
            if (tracksData) {
                console.log(tracksData);
                var tracks = tracksData.map(track => {
                    return { uri: track.uri }
                });

                return await this.delete('/users/'+this.userData.id+'/playlists/'+playlistId+'/tracks', {
                    tracks
                });

            } else return false;
        } catch (err) {
            console.log(err);
        }
    }

    async playback(args, deviceId = null, callback) {
        try {
            if (args && args.command) {
                var track = await this.getCurrentTrack();
                var playback = await this.getCurrentPlayback();

                if (track) {
                    var trackDuration = track.duration_ms;
                    var deviceIdParam = deviceId ? '?device_id=' + deviceId : '';
                    switch (args.command) {
                        case 'play':
                        case 'pause':
                            callback(args.command);
                            return await this.put('/me/player/' + args.command + deviceIdParam);
                            break;
                        case 'previous':
                        case 'next':
                            callback(args.command);
                            return await this.post('/me/player/' + args.command + deviceIdParam);
                            break;
                        case 'seek':
                            var duration = null;
                            if (args.time) {
                                duration = args.time.split(':').reverse().reduce((prev, curr, i) => prev + curr * Math.pow(60, i), 0) * 1000;
                            } else if (args.percentage) {
                                percent = parseInt(args.percentage.replace('%', '').trim()) / 100;
                                duration = trackDuration * percent;
                            } else if (args.number) {
                                duration = parseFloat(args.number.trim()) * 60 * 1000;
                            }

                            if (duration) {
                                callback((duration / 1000) + ' seconds');
                                return await this.put('/me/player/seek' + deviceIdParam + (deviceIdParam ? '&' : '?') + 'position_ms=' + Math.min(duration, trackDuration));
                            }

                            break;
                        case 'repeat':
                            if (playback) {
                                var states = ['off', 'track', 'context'];
                                var currentState = playback.repeat_state;

                                var stateIndex = states.indexOf(currentState);
                                if (stateIndex + 1 > states.length) {
                                    stateIndex = 0;
                                }

                                var state = states[stateIndex + 1];

                                callback(state);
                                return await this.put('/me/player/repeat?state=' + state);
                            }

                            break;
                        case 'shuffle':
                            if (playback) {
                                var state = null;

                                if (args.switchOn) {
                                    state = 'true';
                                } else if (args.switchOff) {
                                    state = 'false';
                                } else {
                                    var currentShuffleState = playback.shuffle_state;
                                    state = !currentShuffleState ? 'true' : 'false';
                                }

                                callback(state === 'true' ? 'on' : 'off');
                                return await this.put('/me/player/shuffle?state=' + state);
                            }

                            break;
                        case 'volume':
                            var percent = 0;
                            if (args.percentage) {
                                percent = parseInt(args.percentage.replace('%', '').trim());
                            } else if (args.number) {
                                percent = Math.min(parseFloat(args.number.trim()), 100);
                            }

                            callback(percent + '%');
                            return await this.put('/me/player/volume?volume_percent=' + percent);

                            break;
                    }
                }
            }

            return false;
        } catch (err) {
            console.log(err);
        }
    }
}

export default Spotify;