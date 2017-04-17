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
    if (session.conversationData.spotifyToken) {
        return new Spotify(session.conversationData.spotifyToken);
    } else {
        message = 'okay before I do that, do you have a spotify account?'
    }

    session.beginDialog('AuthorizeSpotify', { message, options });
}

app.post('/api/messages', connector.listen());

app.get('/', function(req, res) {
    res.send('I\'m a bot... get out!');
});

app.get('/spotify/authorized', function(req, res) {
    if (req.query.code && req.query.state) {
        var address = JSON.parse(req.query.state);
        res.send('<p>thanks, just close this window <3</p>');
        bot.beginDialog(address, 'SpotifyAuthorized', { authCode: req.query.code });
    } else {
        res.status(500);
        res.send('<p>cannot authorize bot :(</p>');
    }
});

// Enable Conversation Data persistence
bot.set('persistConversationData', true);

const recognizer = new builder.LuisRecognizer(process.env.LOUIS_MODEL);
bot.recognizer(recognizer);

const playTrack = async function(session, spotify, query) {
    session.send('looking for your music...');
    session.sendTyping();
    var track = await spotify.getTrack(query);

    if (track) {
        await spotify.play(track.uri);
        session.endDialog('playing **%s** by **%s**, enjoy!', track.name, track.artists.length > 0 ? track.artists[0].name : 'not sure who');
    } else {
        session.endDialog('no music found, sorry.');
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
                        .text("Hello everyone!");
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
                        .text("Goodbye");
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
                .text("Hello %s...", name || 'there');
        bot.send(reply);
    } else {
        // delete their data
    }
});

bot.on('deleteUserData', function (message) {
    // User asked to delete their data
});

bot.dialog('greeting', function(session, args) {
    var name = session.message.user ? session.message.user.name : null;
    session.endDialog('yes?');
}).triggerAction({
    matches: /^hi|hello|hey/i
});

bot.dialog('playback', async function(session, args) {
    var spotify = getSpotify(session);

    if (!spotify) {
        return;
    }

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

}).triggerAction({
    matches: /^play|pause|resume|stop/i
});

bot.dialog('PlayMusic', async function(session, args) {
    if (!args) return session.endDialog();

    var songquery =  builder.EntityRecognizer.findEntity(args.intent.entities, 'songquery');
    if (songquery) {
        var spotify = getSpotify(session, { track: songquery.entity });

        if (!spotify) {
            return;
        }

        playTrack(session, spotify, songquery.entity);
    } else {
        session.endDialog("I didn't understand that...");
    }

}).triggerAction({
    matches: 'PlayMusic'
});

bot.dialog('SpotifyAuthorized', async function(session, args) {
    // authorize spotify
    const tokenData = await Spotify.initToken({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI,
        authCode: args.authCode
    })

    session.conversationData.spotifyToken = tokenData;
    if (session.userData.playTrack) {
        playTrack(session, new Spotify(tokenData), session.userData.playTrack);
    } else {
        session.endDialog('thanks! now type some music that you want me to play or control the playback by typing **pause** or **play** :)');
    }
});

bot.dialog('AuthorizeSpotify', [
    function(session, args) {
        session.userData.playTrack = args.options && args.options.track;
        builder.Prompts.confirm(session, args.message ? args.message : 'do you want me to use your spotify account to play music?');
    },
    function(session, results) {
        if (results.response) {
            var address = JSON.stringify(session.message.address);

            session.endDialog('good, [click here](%s) to authorize me', 'https://accounts.spotify.com/authorize?client_id=933adf0420af4eecb7d70cc8c7687d70&response_type=code&redirect_uri='+encodeURIComponent(process.env.SPOTIFY_REDIRECT_URI)+'&scope=user-read-playback-state+user-modify-playback-state+playlist-read-private+playlist-modify-public+user-library-read+user-read-private+user-read-email+user-follow-modify+playlist-read-collaborative+playlist-modify-private+user-library-modify+user-read-birthdate+user-follow-read+user-top-read&state=' + encodeURIComponent(address));

        } else {
            session.endDialog('okay no problem!');
        }
    }
]);