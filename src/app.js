// https://github.com/Microsoft/BotBuilder-Samples/blob/master/Node/intelligence-LUIS/app.js

import express from 'express';
import http from 'http';
import SocketIO from 'socket.io';
import builder from 'botbuilder';
import uuid from 'uuid';

import Spotify from './lib/spotify';

let app = express();

let server = http.Server(app);
let io = new SocketIO(server);

const port = process.env.PORT;
server.listen(port, function () {
   console.log('listening to %s', port);
});

// Create chat bot
const connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

const bot = new builder.UniversalBot(connector, function (session) {
    session.send('?', session.message.text);
});

const getSpotify = function(session, options) {
    var message = null;
    if (session.userData.spotifyToken && session.userData.spotifyUser) {
        return new Spotify(session.userData.spotifyToken, session.userData.spotifyUser);
    } else {
        message = 'okay before I do that, do you have a spotify account?'
        session.replaceDialog('AuthorizeSpotify', { message, options });
    }
}

const createTrackCard = function(session, track) {
    var artist = track.artists && track.artists.length > 0 ? track.artists[0].name : 'not sure who';
    var title = track.name;
    var album = track.album.name;
    var image = track.album.images[1];
    var url = 'spotify:' + track.uri;

    return new builder.HeroCard(session)
        .title(artist + ' - ' + title)
        .subtitle(album)
        .images([ builder.CardImage.create(session, image.url) ])
        .tap(builder.CardAction.openUrl(session, url));
}

const createPlaylistCard = function(session, playlist) {
    var image = playlist.images[0];
    var url = 'spotify:' + playlist.uri;

    return new builder.HeroCard(session)
        .title(playlist.name)
        .subtitle(playlist.tracks.total + ' tracks')
        .images([ builder.CardImage.create(session, image.url) ])
        .tap(builder.CardAction.openUrl(session, url));
}

app.post('/api/messages', connector.listen());

app.get('/', function(req, res) {
    res.send('I\'m a bot... get out!');
});

app.get('/spotify/authorized', function(req, res) {
    if (req.query.code && req.query.state) {
        var state = JSON.parse(Buffer.from(req.query.state, 'base64'));

        res.send('<p>thanks, just close this window <3</p>');
        bot.beginDialog(state.address, 'SpotifyAuthorized', {
            authCode: req.query.code,
            dialog: state.dialog,
            dialogArgs: state.args
        });

    } else {
        res.status(500);
        res.send('<p>cannot authorize bot :(</p>');
    }
});

// Enable Conversation Data persistence
// bot.set('persistConversationData', true);

const recognizer = new builder.LuisRecognizer(process.env.LOUIS_MODEL);
bot.recognizer(recognizer);

const playPlaylist = async function(session, spotify, playlist) {
    session.send('playing playlist **%s**...', playlist.name);

    var playback = null;

    if (session.userData.spotifyDevice) {
        playback = await spotify.play(null, session.userData.spotifyDevice.id, playlist.uri);
    }

    if (playback) {
        var card = createPlaylistCard(session, playlist);
        var msg = new builder.Message(session)
            .textFormat(builder.TextFormat.markdown)
            .attachments([ card ]);
        session.send(msg);
    } else {
        session.send('can\'t play on current device. :(\n\ntry to type "devices" to select one');
    }
}

const playTrack = async function(session, spotify, query, message = true) {
    session.send('looking for **%s**...', query);
    session.sendTyping();
    var tracks = await spotify.search(query.replace(' \' ', '\''));

    if (tracks) {
        var track = tracks[0];

        var playback = null;
        if (session.userData.spotifyDevice) {
            await spotify.addTrackToPlaylist(track.uri, session.userData.spotifyPlaylist.id);
            playback = await spotify.play(track.uri, session.userData.spotifyDevice.id, session.userData.spotifyPlaylist.uri);
        }

        if (playback) {
            if (message) {
                var card = createTrackCard(session, track);

                var msg = new builder.Message(session)
                    .textFormat(builder.TextFormat.markdown)
                    .attachments([ card ]);
                session.send(msg);
            }

            return tracks;
        } else {
            session.send('can\'t play on current device. :(\n\ntry to type "devices" to select one');
        }
    } else {
        session.endDialog('no music found, sorry.');
        return;
    }
}

bot.on('conversationUpdate', function (message) {
   // Check for group conversations
    if (message.address.conversation.isGroup) {
        // Send a hello message when bot is added
        if (message.membersAdded) {
            message.membersAdded.forEach(function (identity) {
                if (identity.id === message.address.bot.id) {
                    var reply = new builder.Message()
                        .address(message.address)
                        .text("hello everyone!");
                    bot.send(reply);
                }
            });
        }

        // Send a goodbye message when bot is removed
        if (message.membersRemoved) {
            message.membersRemoved.forEach(function (identity) {
                if (identity.id === message.address.bot.id) {
                    var reply = new builder.Message()
                        .address(message.address)
                        .text("k bye");
                    bot.send(reply);
                }
            });
        }
    }
});

bot.on('contactRelationUpdate', function (message) {
    if (message.action === 'add') {
        var name = message.user ? message.user.name : null;
        var reply = new builder.Message()
                .address(message.address)
                .text("hello %s...", name || 'there');
        bot.send(reply);
    } else {
        bot.beginDialog(message.address, 'DeleteUserData', { message: 'k bye' });
    }
});

bot.on('deleteUserData', function (message) {
    bot.beginDialog(message.address, 'DeleteUserData', { message: 'got it' });
});

bot.dialog('Greeting', function(session, args) {
    var name = session.message.user ? session.message.user.name : null;
    var greeting =  builder.EntityRecognizer.findEntity(args.intent.entities, 'greeting');

    session.endDialog('%s, %s :)', greeting ? greeting.entity : 'hey', name.toLowerCase() || 'user');
}).triggerAction({
    matches: 'Greeting'
});

bot.dialog('Compliment', function(session, args) {
    var match = args.intent.matched[0];

    switch (match) {
        case 'thanks':
            session.endDialog('no problem!');
            break;
        case 'ok':
        case 'okay':
            session.endDialog('(y)');
            break;
    }

}).triggerAction({
    matches: /^thanks|ok|okay/i
});

bot.dialog('Playback', async function(session, args) {
    var spotify = getSpotify(session);

    if (spotify) {
        var match = args.intent.matched[0];
        switch (match) {
            case 'pause':
            case 'stop':
                await spotify.pause();
                break;
            case 'play':
            case 'resume':
                await spotify.play();
                break;
        }

        session.endDialog('(y)');
    }

}).triggerAction({
    matches: /^play|pause|resume|stop$/i
});

bot.dialog('PlaylistControl', function(session, args) {
    if (!args) return session.endDialog();

    console.log(args.intent.entities);

    var create = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::create');
    var show = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::show');
    var browse = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::browse');
    var clear = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::clear');

    if (create) {
        var playlistName = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_name');
        session.beginDialog('CreatePlaylist', { name: playlistName && playlistName.entity });
    } else if (show) {
        session.beginDialog('ShowPlaylistQueue');
    } else if (clear) {
        session.beginDialog('ClearPlaylist');
    } else if (browse) {
        session.beginDialog('BrowsePlaylists');
    }

}).triggerAction({
    matches: 'PlaylistControl'
}).cancelAction('cancelPlaylistControl', 'k', {
    matches: 'CancelAction'
});

bot.dialog('BrowsePlaylists', [
    async function(session, args, next) {
        var spotify = getSpotify(session, {
            resumeDialog: 'BrowsePlaylists'
        });

        if (spotify) {
            var data = await spotify.browsePlaylists();

            if (data && data.length > 0) {
                var playlists = {};

                data.forEach((playlist) => {
                    playlists[playlist.name] = playlist;
                });

                session.dialogData.playlists = playlists;
                builder.Prompts.choice(session, 'here are fetured playlists :)', playlists, { listStyle: builder.ListStyle['button'] });
            }
        }
    },
    async function(session, results) {
        if (results.response) {
            if (results.response.entity && session.dialogData.playlists[results.response.entity]) {
                var playlist = session.dialogData.playlists[results.response.entity];
                var spotify = getSpotify(session);
                if (spotify) {
                    await playPlaylist(session, spotify, playlist);
                }
            }
        }
    }
]).cancelAction('cancelAuthorizeSpotify', 'k', { matches: 'CancelAction' });

bot.dialog('ShowPlaylistQueue', async function(session, args, next) {
    var spotify = getSpotify(session, {
        resumeDialog: 'ShowPlaylistQueue'
    });

    if (spotify) {
        var data = await spotify.getPlaylistTracks(session.userData.spotifyPlaylist.id);
        if (data && data.length > 0) {
            var tracks = data.map((track, i) => i + '. ' + track.artists[0].name + ' - ' + track.name);

            data.forEach((playlist) => {
                playlists[playlist.name] = playlist;
            });

            builder.Prompts.choice(session, 'here are songs in queue...', tracks, { listStyle: builder.ListStyle['button'] });
            session.endDialogWithResult();
        } else {
            session.send('no tracks found :(\n\ntype something like "queue ed sheeran - shape of you" to add it to the playlist queue.');
            session.endDialogWithResult();
        }
    }
});

bot.dialog('ClearPlaylist', [
    function(session, args) {
        builder.Prompts.confirm(session, 'are you sure you want to clear queue?');
    },
    async function(session, results) {
        var spotify = getSpotify(session, { resumeDialog: 'ClearPlaylist' });
        if (spotify) {
            if (results.response) {
                var result = await spotify.clearPlaylist(session.userData.spotifyPlaylist.id);
                session.send('done (y)');
                session.endDialogWithResult();
            } else {
                session.send('I thought so ;)');
                session.endDialogWithResult({
                    resumed: builder.ResumeReason.canceled
                });
            }
        }
    }
]);

bot.dialog('SongQuery', async function(session, args) {
    var spotify = getSpotify(session, { resumeDialog: 'SongQuery' });
    if (spotify) {
        const track = await spotify.getCurrentTrack();

        if (track) {
            session.send('here you go');
            var card = createTrackCard(session, track);
            var msg = new builder.Message(session)
                .textFormat(builder.TextFormat.markdown)
                .attachments([ card ]);
            session.send(msg);
        } else {
            session.send('nothing is playing');
        }
    }
}).triggerAction({
    matches: 'SongQuery'
});

bot.dialog('PlayMusic', [
    async function(session, args) {
        if (!args) return session.endDialog();

        var trackQuery = null;

        if (args.playTrack) {
            trackQuery = args.playTrack;
        } else {
            var songtitle =  builder.EntityRecognizer.findEntity(args.intent.entities, 'songtitle');
            var songartist = builder.EntityRecognizer.findEntity(args.intent.entities, 'songartist');

            trackQuery = songtitle.entity + (songartist ? ' artist:' + songartist.entity : '');
        }

        if (trackQuery) {
            var spotify = getSpotify(session, {
                resumeDialog: 'PlayMusic',
                dialogArgs: { playTrack: trackQuery }
            });

            if (spotify) {
                const tracks = await playTrack(session, spotify, trackQuery);
                if (tracks && tracks.length > 1) {
                    var artists = [];

                    tracks.forEach((track) => {
                        var artist = track.artists[0];
                        var query = artist.name + ' - ' + track.name;

                        if (artists.indexOf(query) === -1) {
                            artists.push(query);
                        }
                    });

                    builder.Prompts.choice(session, 'found other versions too...', artists, { listStyle: builder.ListStyle['button'] });
                } else {
                    session.endDialog();
                }
            }
        } else {
            session.endDialog();
        }
    },
    async function(session, results) {
        if (results.response) {
            if (results.response.entity) {
                var spotify = getSpotify(session);
                if (spotify) {
                    await playTrack(session, spotify, results.response.entity);
                    session.endDialog('(y)');
                }
            } else {
                session.endDialog();
            }
        }
    }
]).triggerAction({
    matches: 'PlayMusic'
});

bot.dialog('SpotifySetDevice', [
    async function(session, args, next) {
        var spotify = getSpotify(session, {
            resumeDialog: 'SpotifySetDevice',
            dialogArgs: { playTrack: args && args.playTrack }
        });

        if (spotify) {
            var devices = {};

            var devicesData = await spotify.getDevices();

            if (devicesData && devicesData.length > 0) {
                devicesData.forEach((device) => {
                    devices[device.type + ' - ' + device.name] = device;
                });

                session.dialogData.devices = devices;
                session.dialogData.playTrack = args && args.playTrack;

                if (devicesData.length > 1) {
                    builder.Prompts.choice(session, "which of these devices you want me use?", devices, { listStyle: builder.ListStyle['button'] });
                } else {
                    var defaultDevice = devicesData[0].type + ' - ' + devicesData[0].name;
                    session.send('playing on device **%s**', defaultDevice);
                    next({ response: { entity: defaultDevice } })
                }
            } else {
                session.send('no devices found. [open spotify](spotify:open) and try again :)');
                session.endDialogWithResult({
                    resumed: builder.ResumeReason.notCompleted
                });
            }
        }
    },
    async function(session, results) {
        if (results.response) {
            if (results.response.entity) {
                var device = session.dialogData.devices[results.response.entity];
                session.userData.spotifyDevice = device;
                session.send('(y)');

                var spotify = getSpotify(session, {
                    resumeDialog: 'SpotifySetDevice',
                    dialogArgs: { playTrack: session.dialogData.playTrack }
                });

                if (spotify) {
                    await spotify.setDevice(device.id);
                    if (session.dialogData.playTrack) {
                        await playTrack(session, spotify, session.dialogData.playTrack);
                    }
                }

                session.endDialogWithResult();
            } else {
                session.endDialog('no problem - going to use active device then ;)');
            }
        }
    }
]).triggerAction({
    matches: /(show devices|list devices)|(devices)/i
});

bot.dialog('CreatePlaylist', [
    function(session, args, next) {
        if (args && args.name) {
            next({ response: args.name });
        } else {
            session.send('creating your playlist...');
            builder.Prompts.text(session, 'what\'s the name?');
        }
    },
    async function(session, results) {
        var spotify = getSpotify(session, {
            resumeDialog: 'CreatePlaylist',
            dialogArgs: results.response
        });

        if (spotify) {
            if (results.response) {
                var playlist = await spotify.createPlaylist(results.response);
                if (playlist) {
                    session.send('playlist **%s** created (y)', results.response);
                    session.userData.spotifyPlaylist = playlist;
                    session.endDialogWithResult({
                        response: { playlist }
                    });
                } else {
                    session.send('cannot create playlist :(');
                    session.endDialogWithResult({
                        resumed: builder.ResumeReason.notCompleted
                    });
                }
            }
        }
    }
]);

bot.dialog('SpotifyAuthorized', [
    async function(session, args, next) {
        // authorize spotify
        var tokenData = await Spotify.initToken(args.authCode);
        var data = await new Spotify(tokenData).init();

        if (data && tokenData) {
            session.send('ty. setting up stuff...');

            session.dialogData.args = args;
            session.userData.spotifyUser = data.userData;
            session.userData.spotifyToken = tokenData;

            if (!data.playlist) {
                session.beginDialog('CreatePlaylist', { name: process.env.SPOTIFY_QUEUE_PLAYLIST_NAME });
            } else {
                session.userData.spotifyPlaylist = data.playlist;
                next();
            }

        } else {
            session.send('something went wrong ;(... restarting over.');
            session.replaceDialog('AuthorizeSpotify');
        }
    },
    function(session, results) {
        session.beginDialog('SpotifySetDevice');
    },
    async function(session, results) {
        if (results.response) {
            var args = session.dialogData.args;
            if (args && args.dialog) {
                session.beginDialog(args.dialog, args && args.dialogArgs);
            } else {
                session.endDialog('all set!');
            }
        }
    }
]);

bot.dialog('AuthorizeSpotify', [
    function(session, args) {
        session.dialogData.resumeDialog = args.options && args.options.resumeDialog;
        session.dialogData.dialogArgs = args.options && args.options.dialogArgs;
        builder.Prompts.confirm(session, args.message ? args.message : 'do you want me to use your spotify account to play music?');
    },
    function(session, results) {
        if (results.response) {
            var state = Buffer.from(JSON.stringify({
                address: session.message.address,
                dialog: session.dialogData.resumeDialog,
                args: session.dialogData.dialogArgs
            })).toString('base64');

            session.endDialog('good, [click here](%s) to authorize me', 'https://accounts.spotify.com/authorize?client_id=933adf0420af4eecb7d70cc8c7687d70&response_type=code&redirect_uri='+encodeURIComponent(process.env.SPOTIFY_REDIRECT_URI)+'&scope=user-read-playback-state+user-modify-playback-state+playlist-read-private+playlist-modify-public+user-library-read+user-read-private+user-read-email+user-follow-modify+playlist-read-collaborative+playlist-modify-private+user-library-modify+user-read-birthdate+user-follow-read+user-top-read&state=' + encodeURIComponent(state));

        } else {
            session.endDialog('k nvm');
        }
    }
]).cancelAction('cancelAuthorizeSpotify', 'k', { matches: 'CancelAction' });

bot.dialog('DeleteUserData', function(session, args) {
    session.userData = {};

    session.endDialog(args.message ? args.message : 'all clear! ;)');
}).triggerAction({
    matches: /^reset/i
});