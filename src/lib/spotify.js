// https://github.com/spotify/web-api/issues/321
// auth request:
// https://accounts.spotify.com/authorize?client_id=933adf0420af4eecb7d70cc8c7687d70&response_type=code&redirect_uri=https%3A%2F%2Fwww.lodev09.com%2Fspotify%2Fcallback&scope=user-read-playback-state+user-modify-playback-state+playlist-read-private+playlist-modify-public+user-library-read+user-read-private+user-read-email+user-follow-modify+playlist-read-collaborative+playlist-modify-private+user-library-modify+user-read-birthdate+user-follow-read+user-top-read

import request from 'request';

class Spotify {

    static initToken({ clientId, clientSecret, authCode, redirectUri}) {
        return new Promise((resolve, reject) => {

            const options = {
                url: 'https://accounts.spotify.com/api/token',
                    headers: {
                    'Authorization': 'Basic ' + (new Buffer(clientId + ':' + clientSecret).toString('base64'))
                },
                form: {
                    'grant_type': 'authorization_code',
                    'code': authCode,
                    'redirect_uri': redirectUri
                },
                json: true
            };

            request.post(options, (error, response, body) => {
                if (!error && response.statusCode === 200) {
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
                        'Authorization': 'Basic ' + (new Buffer(this.clientId + ':' + this.clientSecret).toString('base64'))
                    },
                    form: {
                        'grant_type': 'refresh_token',
                        'refresh_token': this.tokenData.refreshToken

                    },
                    json: true
                };

                request.post(options, (error, response, body) => {
                    if (!error && response.statusCode === 200) {
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

    put(endPoint, data) {
        return new Promise(async (resolve, reject) => {
            try {
                var token = await this.getAccessToken();
                var options = {
                    url: 'https://api.spotify.com/v1' + endPoint,
                    body: data,
                    headers: { 'Authorization': 'Bearer ' + token },
                    json: true
                };

                console.log('PUT: ' + endPoint);

                request.put(options, function(error, response, body) {
                    if (!error && response.statusCode === 200) {
                        resolve(body);
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
                    if (!error && response.statusCode === 200) {
                        resolve(body);
                    } else {
                        reject(response.statusCode);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    async getTracks(query) {
        try {
            console.log('searching for "' + query + '"');
            const data = await this.get('/search', {
                q: query,
                type: 'track',
                limit: 20
            });

            if (data && data.tracks.items.length > 0) {
                return data.tracks.items;
            } else return null;

        } catch (err) {
            console.log(err)
        }
    }

    async pause() {
        try {
            await this.put('/me/player/pause');
        } catch (err) {
            console.log(err);
        }
    }

    async play(uri) {
        try {
            await this.put('/me/player/play', uri && {
                uris: [ uri ]
            });
        } catch (err) {
            console.log(err);
        }
    }

    async getDevices() {
        try {
            return await this.get('/me/player/devices');
        } catch (err) {
            console.log(err);
        }
    }

	constructor(tokenData) {
        this.tokenData = tokenData;
	}
}

export default Spotify;