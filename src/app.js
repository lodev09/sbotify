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
    if (session.conversationData.spotifyToken && session.conversationData.spotifyUser) {
        return new Spotify(session.conversationData.spotifyToken, session.conversationData.spotifyUser);
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
    var url = track.external_urls.spotify;

    return new builder.HeroCard(session)
        .title(artist + ' - ' + title)
        .subtitle(album)
        .images([
            builder.CardImage.create(session, image.url)
                .tap(builder.CardAction.showImage(session, image.url))
        ])
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
            playTrack: state.playTrack
        });

    } else {
        res.status(500);
        res.send('<p>cannot authorize bot :(</p>');
    }
});

// Enable Conversation Data persistence
bot.set('persistConversationData', true);

const recognizer = new builder.LuisRecognizer(process.env.LOUIS_MODEL);
bot.recognizer(recognizer);

const playTrack = async function(session, spotify, query, message = true) {
    session.send('looking for your music...');
    session.sendTyping();
    var tracks = await spotify.search(query.replace(' \' ', '\''));

    if (tracks) {
        var track = tracks[0];

        await spotify.play(track.uri, session.conversationData.spotifyDevice.id);

        if (message) {
            var card = createTrackCard(session, track);

            var msg = new builder.Message(session)
                .textFormat(builder.TextFormat.markdown)
                .attachments([ card ]);
            session.send(msg);
        }

        return tracks;
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
    var create = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::create');
    var show = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::show');
    if (create) {
        var playlistName = builder.EntityRecognizer.findEntity(args.intent.entities, 'playlist_name');
        session.beginDialog('CreatePlaylist', { name: playlistName && playlistName.entity });
    } else if (show) {
        session.beginDialog('SetupPlaylist');
    }

}).triggerAction({
    matches: 'PlaylistControl'
});

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

        var songtitle =  builder.EntityRecognizer.findEntity(args.intent.entities, 'songtitle');
        var songartist = builder.EntityRecognizer.findEntity(args.intent.entities, 'songartist');

        var play = builder.EntityRecognizer.findEntity(args.intent.entities, 'player_command::play');
        console.log(play);

        if (songtitle) {
            var track = songtitle.entity + (songartist ? ' artist:' + songartist.entity : '');
            var spotify = getSpotify(session, { playTrack: track });

            if (spotify) {
                const tracks = await playTrack(session, spotify, track);
                if (tracks && tracks.length > 1 && !songartist) {
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
            playTrack: args.playTrack
        });

        if (spotify) {
            var devices = {};
            var data = await spotify.getDevices();
            if (data && data.length > 0) {
                data.forEach((device) => {
                    devices[device.type + ' - ' + device.name] = device;
                });

                session.dialogData.devices = devices;
                session.dialogData.playTrack = args.playTrack;

                builder.Prompts.choice(session, "which of these devices you want me use?", devices, { listStyle: builder.ListStyle['button'] });
            } else {
                session.endDialog('no devices found. [open spotify](spotify:open) and try again :)');
            }
        }
    },
    async function(session, results) {
        if (results.response) {
            if (results.response.entity) {
                var device = session.dialogData.devices[results.response.entity];
                session.conversationData.spotifyDevice = device;
                session.send('got it (y)');

                var spotify = getSpotify(session, {
                    resumeDialog: 'SpotifySetDevice',
                    playTrack: session.dialogData.playTrack
                });

                if (spotify) {
                    await spotify.setDevice(device.id);
                    if (session.dialogData.playTrack) {
                        await playTrack(session, spotify, session.dialogData.playTrack);
                    }
                }

                session.endDialog();
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
            builder.Prompts.text(session, 'what\'s the name of your playlist?');
        }
    },
    async function(session, results) {
        var spotify = getSpotify(session, {
            resumeDialog: 'CreatePlaylist'
        });

        if (spotify) {
            if (results.response) {
                var playlist = await spotify.createPlaylist(results.response);
                if (playlist) {
                    session.send('playlist created (y)');
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

bot.dialog('SetupPlaylist', [
    async function(session, args, next) {
        var spotify = getSpotify(session, {
            resumeDialog: 'SetupPlaylist'
        });

        if (spotify) {
            if (session.conversationData.spotifyPlaylist) {
                next({ response: { entity: session.conversationData.spotifyPlaylist.name } });
            } else {
                var data = await spotify.getPlaylists();
                if (data && data.length > 0) {
                    var playlists = {};

                    data.forEach((playlist) => {
                        playlists[playlist.name] = playlist;
                    });

                    session.dialogData.playlists = playlists;
                    builder.Prompts.choice(session, 'choose a playlist or create one :)', playlists, { listStyle: builder.ListStyle['button'] });
                } else {
                    session.beginDialog('CreatePlaylist');
                }
            }
        }
    },
    function(session, results) {
        if (results.response) {
            if (session.dialogData.playlists[results.response.entity]) {
                var playlist = session.dialogData.playlists[results.response.entity];
                session.conversationData.spotifyPlaylist = playlist;
                session.send('playlist set (y)');
                session.endDialogWithResult({
                    response: { playlist }
                });
            } else if (results.response.contains('create')) {
                session.beginDialog('CreatePlaylist');
            }
        }
    }
]).cancelAction('cancelAuthorizeSpotify', 'k', { matches: 'CancelAction' });

bot.dialog('SpotifyAuthorized', [
    async function(session, args) {
        // authorize spotify
        var tokenData = await Spotify.initToken({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: process.env.SPOTIFY_REDIRECT_URI,
            authCode: args.authCode
        });

        var userData = await new Spotify(tokenData).getUserData();

        session.conversationData.spotifyToken = tokenData;
        session.conversationData.spotifyUser = userData;
        session.dialogData.args= args;
        session.send('thanks!');
        session.beginDialog('SetupPlaylist');
    },
    async function(session, results) {
        var args = session.dialogData.args;
        if (args && args.dialog) {
            session.beginDialog(args.dialog, { playTrack: args.playTrack });
        } else {
            session.endDialog('all set!');
        }
    }
]);

bot.dialog('AuthorizeSpotify', [
    function(session, args) {
        session.dialogData.resumeDialog = args.options && args.options.resumeDialog;
        session.dialogData.playTrack = args.options && args.options.playTrack;
        builder.Prompts.confirm(session, args.message ? args.message : 'do you want me to use your spotify account to play music?');
    },
    function(session, results) {
        if (results.response) {
            var state = Buffer.from(JSON.stringify({
                address: session.message.address,
                dialog: session.dialogData.resumeDialog || 'SpotifySetDevice',
                playTrack: session.dialogData.playTrack
            })).toString('base64');

            session.send('good, [click here](%s) to authorize me', 'https://accounts.spotify.com/authorize?client_id=933adf0420af4eecb7d70cc8c7687d70&response_type=code&redirect_uri='+encodeURIComponent(process.env.SPOTIFY_REDIRECT_URI)+'&scope=user-read-playback-state+user-modify-playback-state+playlist-read-private+playlist-modify-public+user-library-read+user-read-private+user-read-email+user-follow-modify+playlist-read-collaborative+playlist-modify-private+user-library-modify+user-read-birthdate+user-follow-read+user-top-read&state=' + encodeURIComponent(state));
            session.endDialogWithResult();

        } else {
            session.send('k nvm');
            session.endDialogWithResult();
        }
    }
]).cancelAction('cancelAuthorizeSpotify', 'k', { matches: 'CancelAction' });

bot.dialog('DeleteUserData', function(session, args) {
    session.conversationData = {};
    session.userData = {};

    session.endDialog(args.message ? args.message : 'all clear! ;)');
}).triggerAction({
    matches: /^reset/i
});