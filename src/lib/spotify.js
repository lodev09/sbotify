// https://github.com/spotify/web-api/issues/321

import request from 'request';

class Spotify {

    static playbackCommands = ['next', 'previous', 'volume', 'shuffle', 'repeat', 'play', 'pause', 'seek'];
    /*static browseTypes = {
        featured: ,
        new: ,
        categories: ,
        charts:
    };*/

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

    post(endPoint, data) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    headers: { 'Authorization': 'Bearer ' + token },
                    json: true
                };

                if (data) options.body = data;

                console.log('POST: ' + endPoint);

                request.post(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true);
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

    put(endPoint, data) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    headers: { 'Authorization': 'Bearer ' + token },
                    json: true
                };

                if (data) options.body = data;

                console.log('PUT: ' + endPoint);

                request.put(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true);
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

    delete(endPoint, data) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    headers: { 'Authorization': 'Bearer ' + token },
                    json: true
                };

                if (data) options.body = data;

                console.log('DELETE: ' + endPoint);

                request.delete(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true);
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

                if (data) options.qs = data;

                console.log('GET: ' + endPoint);

                request.get(options, function(error, response, body) {
                    if (!error && Spotify.requestOk(response)) {
                        resolve(body || true);
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

    async search(query, options) {
        var queryOptions = Object.assign({ type: 'track', limit: 10, market: 'from_token' }, options);

        try {
            console.log('searching for "' + query + '"');
            const data = await this.get('/search', {
                q: query,
                ...queryOptions
            });

            if (data && data[queryOptions.type + 's'].items.length > 0) {
                return data[queryOptions.type + 's'].items;
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

    async setDevice(deviceId) {
        try {
            return await this.put('/me/player', {
                device_ids: [ deviceId ]
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

    async getBrowseCategories() {
        try {
            var data = await this.get('/browse/categories', {
                country: this.userData.country
            });

            return data && data.categories.items;
        } catch (err) {
            console.log(err);
        }
    }

    async browsePlaylists(type = 'featured-playlists', options) {
        try {
            var data = null;

            switch (type) {
                case 'search':
                    if (options && options.query) {
                        data = await this.search(options.query, {
                            type: 'playlist',
                            limit: 20
                        });
                    }

                    break;
                case 'user-playlists':
                    data = await this.getPlaylists();
                    break;
                case 'featured-playlists':
                    var featuredPlaylists = await this.get('/browse/' + type, {
                        country: this.userData.country
                    });

                    if (featuredPlaylists) {
                        data = featuredPlaylists.playlists.items;
                    }

                    break;
                case 'categories':
                    if (options && options.categoryId) {
                        var categoryPlaylists = await this.get('/browse/categories/' + options.categoryId + '/playlists', {
                            country: this.userData.country
                        });

                        if (categoryPlaylists) {
                            data = categoryPlaylists.playlists.items;
                        }
                    }

                    break;
                case 'charts':
                    var chartPlaylists = ['37i9dQZEVXbMDoHDwVN2tF', '37i9dQZEVXbLiRSasKsNU9'];
                    var playlists = [];

                    for (var i in chartPlaylists) {
                        var playlistId = chartPlaylists[i];
                        var playlistData = await this.get('/users/spotifycharts/playlists/' + playlistId, {
                            market: this.userData.country,
                            fields: 'collaborative, description, external_urls, followers, href, id, images, name, tracks(!items), owner, public, snapshot_id, type, uri'
                        });

                        playlists.push(playlistData);
                    }

                    data = playlists;
                    break;
                case 'search':
                    // search playlists here
                    break;
            }

            return data;
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

    async getPlaylistTracks(ownerId, playlistId) {
        try {
            var data = await this.get('/users/'+ownerId+'/playlists/'+playlistId+'/tracks', {
                market: this.userData.country,
                fields: 'items(track(id, artists, external_urls, uri, name, album(id, name, images)))'
            });

            return data && data.items.map(item => item.track);
        } catch (err) {
            console.log(err);
        }
    }

    async addTrackToPlaylist(uri, playlistId) {
        try {
            var currentTracks = await this.getPlaylistTracks(this.userData.id, playlistId);
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
            var tracksData = await this.getPlaylistTracks(this.userData.id, playlistId);
            if (tracksData) {
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
            var result = false;
            if (args && args.command) {
                var track = await this.getCurrentTrack();
                var playback = await this.getCurrentPlayback();

                if (track) {
                    var trackDuration = track.duration_ms;
                    var deviceIdParam = deviceId ? '?device_id=' + deviceId : '';
                    switch (args.command) {
                        case 'play':
                        case 'pause':
                            result = await this.put('/me/player/' + args.command + deviceIdParam);
                            if (result) {
                                callback('okay');
                            }

                            break;
                        case 'previous':
                        case 'next':
                            result = await this.post('/me/player/' + args.command + deviceIdParam);
                            if (result) {
                                await this.put('/me/player/play');
                                setTimeout(async () => {
                                    var track = await this.getCurrentTrack();
                                    callback('now playing **' + track.artists[0].name + ' - ' + track.name + '**');
                                }, 2000)
                            }

                            break;
                        case 'seek':
                            var duration = null;
                            if (args.time) {
                                duration = args.time.split(':').reverse().reduce((prev, curr, i) => prev + curr * Math.pow(60, i), 0) * 1000;
                            } else if (args.number) {
                                percent = parseInt(args.number.trim()) / 100;
                                duration = trackDuration * percent;
                            }

                            if (duration) {
                                result = await this.put('/me/player/seek' + deviceIdParam + (deviceIdParam ? '&' : '?') + 'position_ms=' + Math.min(duration, trackDuration));
                                if (result) {
                                    callback('seeked to ' + (( duration / 1000 / 60 )) + ' mins');
                                }
                            }

                            break;
                        case 'repeat':
                            if (playback) {
                                var state = 'off';
                                var states = ['off', 'track', 'context'];

                                if (args.switchOff) {
                                    state = 'off';
                                } else {
                                    var currentState = playback.repeat_state;
                                    var stateIndex = states.indexOf(currentState);
                                    if (stateIndex + 1 > states.length) {
                                        stateIndex = 0;
                                    }

                                    state = states[stateIndex + 1];
                                }

                                result = await this.put('/me/player/repeat?state=' + state);
                                if (result) {
                                    callback('repeat is now **'+state+'**');
                                }
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

                                result = await this.put('/me/player/shuffle?state=' + state);
                                if (result) {
                                    callback(state === 'true' ? 'on' : 'off');
                                }
                            }

                            break;
                        case 'volume':
                            var percent = 0;
                            if (args.number) {
                                percent = Math.min(parseFloat(args.number.trim()), 100);
                            }

                            result = await this.put('/me/player/volume?volume_percent=' + percent);
                            if (result) {
                                callback('volume set to **' + percent + '%**');
                            }

                            break;
                    }
                }
            }

            return result;
        } catch (err) {
            console.log(err);
        }
    }
}

export default Spotify;
