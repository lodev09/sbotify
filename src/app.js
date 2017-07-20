// https://github.com/Microsoft/BotBuilder-Samples/blob/master/Node/intelligence-LUIS/app.js

import express from 'express';
import http from 'http';
import {
    ChatConnector,
    UniversalBot,
    LuisRecognizer,
    HeroCard,
    CardImage,
    CardAction,
    Message,
    TextFormat,
    EntityRecognizer,
    Prompts,
    ListStyle,
    ResumeReason
} from 'botbuilder';
import uuid from 'uuid';
import emoji from 'node-emoji';

import Spotify from './lib/spotify';

let app = express();

let server = http.Server(app);

const port = process.env.PORT;
server.listen(port, function () {
   console.log('listening to %s', port);
});

// Create chat bot
const connector = new ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD,
    gzipData: true
});

const parseName = function(session, def) {
    if (!session.message.user) return def;
    var name = session.message.user.name.trim().toLowerCase().match(/^[\w]+/i);

    return name === '' ? def : name;
}

const bot = new UniversalBot(connector, function (session) {
    session.send("sorry %s, I didn't understand", parseName(session));
    session.beginDialog('ShowHelp');
});

const getSpotify = function(session, options) {
    var message = null;
    if (session.conversationData.spotifyToken && session.conversationData.spotifyUser) {
        return new Spotify(session.conversationData.spotifyToken, session.conversationData.spotifyUser);
    } else {
        message = 'okay before I do that, do you have a spotify account?\n\n\\*\\* _Warning: you must be a **premium** user to use playback service_'
        session.replaceDialog('AuthorizeSpotify', { message, options });
    }
}

const createTrackCard = function(session, track) {
    var artist = track.artists && track.artists.length > 0 ? track.artists[0].name : 'not sure who';
    var title = track.name;
    var album = track.album.name;
    var image = track.album.images[1];
    var url = track.external_urls.spotify;

    var date = new Date(null);
    date.setSeconds(track.duration_ms / 1000);
    var mins = date.toISOString().substr(14, 5);

    return new HeroCard(session)
        .title(artist + ' - ' + title)
        .subtitle(mins)
        .text(album)
        .images([ CardImage.create(session, image.url) ])
        .tap(CardAction.openUrl(session, url));
}

const createPlaylistCard = function(session, playlist, images = true) {
    var image = playlist.images[0];
    var url = playlist.external_urls.spotify;

    var card = new HeroCard(session)
        .title(playlist.name)
        .subtitle(playlist.tracks.total + ' tracks')
        .tap(CardAction.openUrl(session, url));

    if (images) {
        card.images([ CardImage.create(session, image.url) ]);
    }

    return card;
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

// install mention middleware. fixes #2530 and #2419
bot.use({
    receive: (e, session, next) => {
        const mention = '@' + e.address.bot.name;
        if (e.type === 'message') {
            if (e.text.includes(mention)) {
                e.text = e.text.replace(mention, '').trim();
            }
        }

        next();
    }
});

// Enable Conversation Data persistence
bot.set('persistConversationData', true);

const recognizer = new LuisRecognizer(process.env.LOUIS_MODEL);
bot.recognizer(recognizer);

const playTrack = async function(session, spotify, track) {
    session.send('now playing. enjoy ' + emoji.get('musical_note'));
    session.sendTyping();

    var playback = null;

    if (session.conversationData.spotifyDevice) {
        try {
            playback = await spotify.play(track.uri, session.conversationData.spotifyDevice.id, session.conversationData.spotifyPlaylist.uri);
        } catch (err) {
            session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
            console.log(err);
        }

        if (playback) {
            var card = createTrackCard(session, track);
            var msg = new Message(session)
                .textFormat(TextFormat.markdown)
                .attachments([ card ]);
            session.send(msg);
        } else {
            session.send('can\'t play on current device. :(\n\ntry to say "devices" to select one :)');
        }
    } else {
        session.send('device not set. say "show devices" to get started.');
    }
}

const playPlaylist = async function(session, spotify, playlist) {
    session.send('playing **%s** %s', playlist.name, emoji.get('musical_note'));
    session.sendTyping();

    var playback = null;

    if (session.conversationData.spotifyDevice) {
        try {
            playback = await spotify.play(null, session.conversationData.spotifyDevice.id, playlist.uri);
            session.conversationData.spotifyPlaylist = playlist;
        } catch (err) {
            session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
            console.log(err);
        }

        if (playback) {
            var card = createPlaylistCard(session, playlist);
            var msg = new Message(session)
                .textFormat(TextFormat.markdown)
                .attachments([ card ]);
            session.send(msg);
        } else {
            session.send('can\'t play on current device. :(\n\ntry to say "devices" to select one');
        }
    } else {
        session.send('device not set. type "show devices" to get started.');
    }
}

const queueTrack = async function(session, spotify, query, message = true) {
    session.send('looking for **%s**...', query);
    session.sendTyping();

    try {
        var tracks = await spotify.search(query);

        if (tracks) {
            var track = tracks[0];

            var playback = await spotify.addTrackToPlaylist(track.uri, session.conversationData.spotifyBotPlaylist.id);
            if (message) {
                session.send('**%s** by **%s** added to **bot queue** (y)', track.name, track.artists[0].name);
                if (session.conversationData.spotifyBotPlaylist.id !== session.conversationData.spotifyPlaylist.id) {
                    session.send('you\'re not under **bot queue**, type "browse" to select it ;)');
                }
            }

            return tracks;
        } else {
            session.endDialog('no music found, sorry.');
            return;
        }

    } catch (err) {
        session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
        console.log(err);
    }
}

const playTrackNumber = async function(session, spotify, number) {
    session.sendTyping();
    var data = await spotify.getPlaylistTracks(session.conversationData.spotifyPlaylist.owner.id, session.conversationData.spotifyPlaylist.id);
    if (data && data.length > 0) {
        var track = data[Math.max(1, number) - 1];
        if (track) {
            await playTrack(session, spotify, track);
        } else {
            session.send('track **#%s** not in queue. try to type "show queue" to get a list of tracks :)', number);
        }
    } else {
        session.send('track number not found :(');
    }
}

const playTrackQuery = async function(session, spotify, query, message = true) {
    session.send('looking for **%s**...', query);
    session.sendTyping();

    try {
        var tracks = await spotify.search(query);

        if (tracks) {
            var track = tracks[0];

            var playback = null;
            if (session.conversationData.spotifyDevice) {
                await spotify.addTrackToPlaylist(track.uri, session.conversationData.spotifyBotPlaylist.id);
                playback = await spotify.play(track.uri, session.conversationData.spotifyDevice.id, session.conversationData.spotifyBotPlaylist.uri);

                if (playback) {
                    if (session.conversationData.spotifyPlaylist.id !== session.conversationData.spotifyBotPlaylist.id) {
                        session.send('now playing on **bot\'s queue** ' + emoji.get('musical_note'));
                        session.conversationData.spotifyPlaylist = session.conversationData.spotifyBotPlaylist;
                    }
                    if (message) {
                        var card = createTrackCard(session, track);
                        var msg = new Message(session)
                            .textFormat(TextFormat.markdown)
                            .attachments([ card ]);
                        session.send(msg);
                    }

                    return tracks;
                } else {
                    session.send('can\'t play on current device. :(\n\ntry to say "devices" to select one');
                }
            } else {
                session.send('device not set. type "show devices" to get started.');
            }
        } else {
            session.endDialog('no music found, sorry.');
            return;
        }
    } catch (err) {
        session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
        console.log(err);
    }
}

bot.on('conversationUpdate', function (message) {
   // Check for group conversations
    if (message.address.conversation.isGroup) {
        // Send a hello message when bot is added
        if (message.membersAdded) {
            message.membersAdded.forEach(function (identity) {
                if (identity.id === message.address.bot.id) {
                    var reply = new Message()
                        .address(message.address)
                        .text("hello everyone!");
                    bot.send(reply);
                    bot.beginDialog(message.address, 'ShowHelp');
                }
            });
        }

        // Send a goodbye message when bot is removed
        if (message.membersRemoved) {
            message.membersRemoved.forEach(function (identity) {
                if (identity.id === message.address.bot.id) {
                    var reply = new Message()
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
        var reply = new Message()
                .address(message.address)
                .text("hello %s...", parseName({ message }));
        bot.send(reply);
        bot.beginDialog(message.address, 'ShowHelp');
    } else {
        bot.beginDialog(message.address, 'DeleteUserData', { message: 'k bye' });
    }
});

bot.on('deleteUserData', function (message) {
    bot.beginDialog(message.address, 'DeleteUserData', { message: 'got it' });
});

bot.dialog('Greeting', [
    function(session, args) {
        var greeting =  EntityRecognizer.findEntity(args.intent.entities, 'greeting');

        var msg = new Message(session)
            .text([
                'hi %s',
                "what's up?",
                'yes?',
                'hello %s',
                'what can I do for you %s?',
                'you again %s?',
                'what do you want today %s?',
                'what is it that you want %s?',
                'what do you want?',
                'yoh',
                'hey %s',
                'hey'
            ], parseName(session));

        session.send(msg);
        Prompts.confirm(session, 'do you need help?')
    },
    function(session, results) {
        if (results.response) {
            session.send([
                'got it',
                'okay',
                'no problem',
                'sure'
            ]);

            session.beginDialog('ShowHelp');
        } else {
            session.endDialog([
                'kool',
                '(y)',
                ':)',
                'yep',
                'ok',
                'k',
                'got it'
            ]);
        }
    }
]).triggerAction({
    matches: 'Greeting'
});

bot.dialog('Compliment', function(session, args) {
    session.endDialog([
        'no problem %s!',
        '(y)',
        'okay %s',
        'sure %s',
        'anytime ;)'
    ], parseName(session));

}).triggerAction({
    matches: /^(?:\@[\w-_]+\s+)?(?:thanks|thank you)/i
});

bot.dialog('PlayerControl', function(session, args) {
    if (!args) return session.endDialog('use common playback words like "play", "pause", etc.');

    for (var i in Spotify.playbackCommands) {
        var command = Spotify.playbackCommands[i];

        var commandEntity = EntityRecognizer.findEntity(args.intent.entities, 'player_command::' + command);
        if (commandEntity) {
            var number = EntityRecognizer.findEntity(args.intent.entities, 'builtin.number');
            var time = EntityRecognizer.findEntity(args.intent.entities, 'builtin.datetime.time');
            var switchOn = EntityRecognizer.findEntity(args.intent.entities, 'switch::on');
            var switchOff = EntityRecognizer.findEntity(args.intent.entities, 'switch::off');

            return session.beginDialog('ApplyPlayerCommand', {
                number: number && number.entity,
                time: time && time.entity,
                switchOn,
                switchOff,
                command
            });
        }
    }

}).triggerAction({
    matches: 'PlayerControl'
});

bot.dialog('ApplyPlayerCommand', async function(session, args) {
    session.sendTyping();

    var spotify = getSpotify(session, {
        resumeDialog: 'ApplyPlayerCommand',
        dialogArgs: {
            ...args
        }
    });

    if (spotify) {
        try {
            if (session.conversationData.spotifyDevice) {
                var result = await spotify.playback(args, session.conversationData.spotifyDevice.id, (message) => {
                    session.send('%s', message);
                });

                if (!result) {
                    session.send('cannot connect to device. try to say "devices" to select one :)');
                }

                session.endDialogWithResult({ response: result })
            } else {
                session.send('can\'t play on current device. :(\n\ntry to say "devices" to select one');
                session.endDialogWithResult();
            }
        } catch (err) {
            session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
            console.log(err);
        }
    }
});

bot.dialog('PlaylistControl', function(session, args) {
    if (!args) return session.endDialog('use command playlist words like "browse", "show", "clear", etc.');

    var create = EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::create');
    var show = EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::show');
    var browse = EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::browse');
    var playlistquery = EntityRecognizer.findEntity(args.intent.entities, 'playlistquery');

    var clear = EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::clear');
    var add = EntityRecognizer.findEntity(args.intent.entities, 'playlist_command::add');

    var songtitle =  EntityRecognizer.findEntity(args.intent.entities, 'songtitle');
    var songartist = EntityRecognizer.findEntity(args.intent.entities, 'songartist');

    if (show) {
        if (/top|featured/i.test(session.message.text)) {
            session.send('you meant to **browse** playlist right? :)');
            session.beginDialog('BrowsePlaylists', { playlistquery: playlistquery && playlistquery.entity });
        } else {
            session.beginDialog('ShowPlaylistQueue');
        }
    } else if (clear) {
        session.beginDialog('ClearPlaylist');
    } else if (browse) {
        session.beginDialog('BrowsePlaylists', { playlistquery: playlistquery && playlistquery.entity });
    } else if (add || songtitle) {
        if (songtitle) {
            var trackQuery = songtitle.entity + (songartist ? ' artist:' + songartist.entity : '');
            session.beginDialog('AddMusic', {
                trackQuery
            });
        }
    } else {
        if (/playlist|queue/i.test(session.message.text)) {
            session.send('you meant to show queue right? :)');
            session.beginDialog('ShowPlaylistQueue');
        } else {
            session.endDialog('not sure what you mean there.');
        }
    }

}).triggerAction({
    matches: 'PlaylistControl'
}).cancelAction('cancelPlaylistControl', 'k', { matches: /^(?:\@[\w-_]+\s+)?(?:cancel|nvm|nevermind)/i });

const browseTypes = {
    '1. My Playlists' : 'user-playlists',
    '2. Featured' : 'featured-playlists',
    '3. Genres & Moods' : 'categories',
    '4. Charts' : 'charts',
    '5. Search' : 'search'
};

bot.dialog('BrowsePlaylists', [
    function(session, args, next) {
        if (args) {
            if (args.playlistquery) {
                next({
                    response: {
                        entity: Object.keys(browseTypes)[4],
                        searchQuery: args.playlistquery
                    }
                });

                return;
            } else if (args.selectedType) {
                next({
                    response: {
                        entity: args.selectedType
                    }
                });

                return;
            }
        }

        Prompts.choice(session, 'pick one...', browseTypes, { listStyle: ListStyle['button'] });
    },
    async function (session, results, next) {
        if (results.response) {
            session.sendTyping();

            session.dialogData.selectedType = results.response.entity;
            var type = browseTypes[results.response.entity];

            if (type === 'categories') {
                var spotify = getSpotify(session, {
                    resumeDialog: 'BrowsePlaylists',
                    dialogArgs: {
                        selectedType: results.response.entity
                    }
                });

                if (spotify) {
                    var categoriesData = await spotify.getBrowseCategories();
                    if (categoriesData) {
                        var categories = {};

                        categoriesData.forEach((category) => {
                            categories[category.name] = category.id;
                        });

                        session.dialogData.categories = categories;
                        Prompts.choice(session, 'select your genre/mood...', categories, { listStyle: ListStyle['auto'] });
                    }
                }

            } else if (type === 'search') {
                if (results.response.searchQuery) {
                    session.send('searching for **%s**', results.response.searchQuery)
                    next({ response: results.response.searchQuery })
                } else {
                    Prompts.text(session, 'so what are you looking for?');
                }
            } else {
                next();
            }
        }
    },
    async function(session, results, next) {
        if (session.dialogData.selectedType) {
            var spotify = getSpotify(session, {
                resumeDialog: 'BrowsePlaylists',
                dialogArgs: {
                    selectedType: session.dialogData.selectedType
                }
            });

            if (spotify) {
                var type = browseTypes[session.dialogData.selectedType];
                try {
                    var options = {};
                    if (type === 'categories') {
                        if (results.response.entity) {
                            options.categoryId = session.dialogData.categories[results.response.entity];
                            options.shouldSearch = false; // should search for playlists
                        } else {
                            session.send('you must choose your mood :(');
                            return session.endDialogWithResult({
                                resumed: ResumeReason.notCompleted
                            });
                        }
                    } else if (type === 'search') {
                        if (results.response) {
                            options.query = results.response;
                        } else {
                            session.send('you must be looking for something. try again later :)');
                            return session.endDialogWithResult({
                                resumed: ResumeReason.notCompleted
                            });
                        }
                    }

                    session.sendTyping();
                    var data = await spotify.browsePlaylists(type, options);

                    if (data && data.length > 0) {
                        var playlists = {};

                        data.forEach((playlist) => {
                            playlists[playlist.name] = playlist;
                        });

                        session.dialogData.playlists = playlists;
                        Prompts.choice(session, 'here\'s what I got. type the number or "cancel" ;)', playlists, { listStyle: ListStyle['auto'] });
                    } else {
                        session.send('nothing :(');
                        session.endDialogWithResult();
                    }
                } catch (err) {
                    session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                    console.log(err);
                }
            }
        }
    },
    async function(session, results) {
        if (results.response) {
            if (results.response.entity && session.dialogData.playlists[results.response.entity]) {
                var playlist = session.dialogData.playlists[results.response.entity];
                var spotify = getSpotify(session);
                if (spotify) {
                    try {
                        await playPlaylist(session, spotify, playlist);
                    } catch (err) {
                        session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                        console.log(err);
                    }
                }
            }
        }
    }
]).cancelAction('cancelBrowsePlaylists', 'k', { matches: /^(?:\@[\w-_]+\s+)?(?:cancel|nvm|nevermind)/i });

bot.dialog('ShowPlaylistQueue', [
    async function(session, args, next) {
        session.sendTyping();

        var spotify = getSpotify(session, {
            resumeDialog: 'ShowPlaylistQueue'
        });

        if (spotify) {
            try {
                var currentTrack = await spotify.getCurrentTrack();
                var data = await spotify.getPlaylistTracks(session.conversationData.spotifyPlaylist.owner.id, session.conversationData.spotifyPlaylist.id);
                if (data && data.length > 0) {
                    var tracks = {};
                    data.forEach((track) => {
                        var text = currentTrack && currentTrack.id === track.id ?
                            '**' + track.artists[0].name + ' - ' + track.name + '** ' + emoji.get('musical_note') :
                            track.artists[0].name + ' - ' + track.name;

                        tracks[text] = track;
                    });

                    session.dialogData.tracks = tracks;
                    var card = createPlaylistCard(session, session.conversationData.spotifyPlaylist, false);
                    var msg = new Message(session)
                        .textFormat(TextFormat.markdown)
                        .attachments([ card ]);

                    session.send(msg);
                    Prompts.choice(session, 'pick one or type "cancel" ;)', tracks, { listStyle: ListStyle['auto'] });
                } else {
                    session.send('no tracks found in current playlist :(\n\nmaybe it\'s private. tsk.');
                    session.endDialogWithResult();
                }
            } catch (err) {
                session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                console.log(err);
            }
        }
    },
    async function(session, results, next) {
        if (results.response && results.response.entity) {
            var spotify = getSpotify(session, {
                resumeDialog: 'ShowPlaylistQueue'
            });

            if (spotify) {
                try {
                    var track = session.dialogData.tracks[results.response.entity];
                    await playTrack(session, spotify, track);
                    session.endDialogWithResult();
                } catch (err) {
                    session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                    console.log(err);
                }
            }
        }
    }
]).cancelAction('cancelShowPlaylistQueue', 'k', { matches: /^(?:\@[\w-_]+\s+)?(?:cancel|nvm|nevermind)/i });

bot.dialog('ClearPlaylist', [
    function(session, args) {
        Prompts.confirm(session, 'are you sure you want to clear our **bot queue**?');
    },
    async function(session, results) {
        session.sendTyping();

        var spotify = getSpotify(session, { resumeDialog: 'ClearPlaylist' });
        if (spotify) {
            if (results.response) {
                try {
                    var result = await spotify.clearPlaylist(session.conversationData.spotifyBotPlaylist.id);
                    if (result) {
                        session.send('done (y)');
                    } else {
                        session.send('can\'t :(');
                    }
                    session.endDialogWithResult();
                } catch (err) {
                    session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                    console.log(err);
                }
            } else {
                session.send('I thought so ;)');
                session.endDialogWithResult({
                    resumed: ResumeReason.canceled
                });
            }
        }
    }
]);

bot.dialog('SongQuery', async function(session, args) {
    session.sendTyping();

    var spotify = getSpotify(session, { resumeDialog: 'SongQuery' });
    if (spotify) {
        try {
            const track = await spotify.getCurrentTrack();

            if (track) {
                session.send('here you go');
                var card = createTrackCard(session, track);
                var msg = new Message(session)
                    .textFormat(TextFormat.markdown)
                    .attachments([ card ]);
                session.send(msg);
            } else {
                session.send('nothing. try to say "play shape of you" ;)');
            }
        } catch (err) {
            session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
            console.log(err);
        }
    }
}).triggerAction({
    matches: 'SongQuery'
});

bot.dialog('ShowHelp', [
    function(session, args) {
        if (!session.conversationData.spotifyUser) {
            session.send('setup spotify by saying "init"');
        }

        if (!session.conversationData.spotifyDevice) {
            session.send('setup your device by saying "devices"');
        }

        var helps = [
            'browse',
            'play/queue shape of you',
            'play, pause, next, previous, etc.',
            'search for "top hits"',
            'show queue',
            'quit'
        ];
        session.send('command me by saying...\n\n- ' + helps.join('\n- '));
        Prompts.confirm(session, 'do you want more?');
    },
    function(session, results) {
        if (results.response) {
            var moreHelps = [
                'clear queue',
                'play track 5',
                'set volume 80%',
                'seek 2:00',
                'set repeat',
                'set shuffle',
                'what\'s playing?',
                'help'
            ];

            session.send('here\'s more I can do...\n\n- ' + moreHelps.join('\n- '));
            session.endDialogWithResult();
        } else {
            session.send([
                'I thought so ;)',
                'got it (y)',
                '(y)',
                ';)',
                'kool'
            ]);

            session.endDialogWithResult({
                resumed: ResumeReason.notCompleted
            });
        }
    }
]).triggerAction({
    matches: 'ShowHelp'
});

bot.dialog('PlayMusic', [
    async function(session, args, next) {
        if (!args) return session.endDialog();

        var trackQuery = null;
        var trackNumber = null;
        var playCommand = null;

        if (args.playTrackQuery) {
            trackQuery = args.playTrackQuery;
        } else if (args.playTrackNumber) {
            trackNumber = args.playTrackNumber;
        } else if (args.playCommand) {
            playCommand = args.playCommand;
        } else {
            if (args.intent) {
                var songtitle =  EntityRecognizer.findEntity(args.intent.entities, 'songtitle');
                var songartist = EntityRecognizer.findEntity(args.intent.entities, 'songartist');
                var play = EntityRecognizer.findEntity(args.intent.entities, 'player_command::play');
                var number = EntityRecognizer.findEntity(args.intent.entities, 'builtin.number');

                if (songtitle) {
                    trackQuery = songtitle.entity + (songartist ? ' artist:' + songartist.entity : '');
                } else if (play) {
                    playCommand = true;
                    trackNumber = number && number.entity;
                }
            }
        }

        var spotify = getSpotify(session, {
            resumeDialog: 'PlayMusic',
            dialogArgs: {
                playTrackQuery: trackQuery,
                playTrackNumber: trackNumber,
                playCommand: playCommand
            }
        });

        if (spotify) {
            try {
                if (trackQuery) {
                    const tracks = await playTrackQuery(session, spotify, trackQuery);
                    if (tracks && tracks.length > 1) {
                        var artists = [];

                        tracks.forEach((track) => {
                            var artist = track.artists[0];
                            var query = artist.name + ' - ' + track.name;

                            if (artists.indexOf(query) === -1) {
                                artists.push(query);
                            }
                        });

                        Prompts.choice(session, 'found other versions too...', artists, { listStyle: ListStyle['button'] });
                    }

                    session.endDialog();
                } else {

                    if (play) {
                        if (trackNumber) {
                            await playTrackNumber(session, spotify, parseInt(trackNumber));
                        } else {

                            var query = session.message.text.replace(play.entity, '').trim();
                            if (query !== '') {
                                session.dialogData.trackQuery = query;
                                Prompts.confirm(session, 'are you looking for "' + query + '"?');
                            } else {
                                session.beginDialog('ApplyPlayerCommand', { command: 'play' });
                            }
                        }
                    } else {
                        session.endDialog();
                    }
                }

            } catch (err) {
                session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                console.log(err);
            }
        }

    },
    function(session, results) {
        if (results.response) {
            session.beginDialog('PlayMusic', { playTrackQuery: session.dialogData.trackQuery });
        }
    }
]).triggerAction({
    matches: 'PlayMusic'
});

bot.dialog('AddMusic', [
    async function(session, args) {
        if (!args) return session.endDialogWithResult();

        var trackQuery = args.trackQuery;

        if (trackQuery) {
            var spotify = getSpotify(session, {
                resumeDialog: 'AddMusic',
                dialogArgs: { queueTrack: trackQuery }
            });

            if (spotify) {
                try {
                    var tracks = await queueTrack(session, spotify, trackQuery);
                    if (tracks && tracks.length > 1) {
                        var artists = [];

                        tracks.forEach((track) => {
                            var artist = track.artists[0];
                            var query = artist.name + ' - ' + track.name;

                            if (artists.indexOf(query) === -1) {
                                artists.push(query);
                            }
                        });

                        Prompts.choice(session, 'you might want to check some of these...', artists, { listStyle: ListStyle['auto'] });
                    } else {
                        session.endDialogWithResult();
                    }
                } catch (err) {
                    session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                    console.log(err);
                }
            }
        } else {
            session.endDialogWithResult();
        }
    },
    async function(session, results) {
        if (results.response) {
            if (results.response.entity) {
                var spotify = getSpotify(session);
                if (spotify) {
                    try {
                        await queueTrack(session, spotify, results.response.entity);
                        session.send('(y)');
                    } catch (err) {
                        session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                        console.log(err);
                    }

                    session.endDialogWithResult();
                }
            } else {
                session.endDialogWithResult();
            }
        }
    }
]);

bot.dialog('SpotifySetDevice', [
    async function(session, args, next) {
        session.sendTyping();

        var spotify = getSpotify(session, {
            resumeDialog: 'SpotifySetDevice',
            dialogArgs: { playTrackQuery: args && args.playTrackQuery }
        });

        if (spotify) {
            var devices = {};

            try {
                var devicesData = await spotify.getDevices();

                if (devicesData && devicesData.length > 0) {
                    devicesData.forEach((device) => {
                        devices[device.type + ' - ' + device.name] = device;
                    });

                    session.dialogData.devices = devices;
                    session.dialogData.playTrackQuery = args && args.playTrackQuery;

                    if (devicesData.length > 1) {
                        Prompts.choice(session, "which of these devices you want me use?", devices, { listStyle: ListStyle['button'] });
                    } else {
                        var defaultDevice = devicesData[0].type + ' - ' + devicesData[0].name;
                        session.send('playing on device **%s**', defaultDevice);
                        next({ response: { entity: defaultDevice } })
                    }
                } else {
                    session.send('no devices found. [open spotify](https://open.spotify.com) and try again :)');
                    session.endDialogWithResult({
                        resumed: ResumeReason.notCompleted
                    });
                }
            } catch (err) {
                session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                console.log(err);
            }
        }
    },
    async function(session, results) {
        session.sendTyping();

        if (results.response) {
            if (results.response.entity) {
                var device = session.dialogData.devices[results.response.entity];
                session.conversationData.spotifyDevice = device;
                session.send('(y)');

                var spotify = getSpotify(session, {
                    resumeDialog: 'SpotifySetDevice',
                    dialogArgs: { playTrackQuery: session.dialogData.playTrackQuery }
                });

                if (spotify) {
                    try {
                        await spotify.setDevice(device.id);
                        if (session.dialogData.playTrackQuery) {
                            await playTrackQuery(session, spotify, session.dialogData.playTrackQuery);
                        }
                    } catch (err) {
                        session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                        console.log(err);
                    }
                }

                session.endDialogWithResult();
            } else {
                session.send('no problem - going to use active device then ;)');
                session.endDialogWithResult();
            }
        }
    }
]).triggerAction({
    matches: /^(?:\@[\w-_]+\s+)?(?:show devices|list devices|devices|setup devices|setup device)/i
}).cancelAction('cancelSpotifySetDevice', 'k', { matches: /^(?:\@[\w-_]+\s+)?(?:cancel|nvm|nevermind)/i });;

bot.dialog('CreatePlaylist', [
    function(session, args, next) {
        if (args && args.name) {
            next({ response: args.name });
        } else {
            session.send('creating your playlist...');
            Prompts.text(session, 'what\'s the name?');
        }
    },
    async function(session, results) {
        session.sendTyping();

        var spotify = getSpotify(session, {
            resumeDialog: 'CreatePlaylist',
            dialogArgs: results.response
        });

        if (spotify) {
            if (results.response) {
                try {
                    var playlist = await spotify.createPlaylist(results.response);
                    if (playlist) {
                        session.send('playlist **%s** created (y)', results.response);
                        session.conversationData.spotifyBotPlaylist = playlist;
                        if (!session.conversationData.spotifyPlaylist) {
                            session.conversationData.spotifyPlaylist = playlist;
                        }

                        session.endDialogWithResult({
                            response: { playlist }
                        });
                    } else {
                        session.send('cannot create playlist :(');
                        session.endDialogWithResult({
                            resumed: ResumeReason.notCompleted
                        });
                    }
                } catch (err) {
                    session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
                    console.log(err);
                }
            }
        }
    }
]);

bot.dialog('SpotifyAuthorized', [
    async function(session, args, next) {
        session.sendTyping();

        try {
            // authorize spotify
            var tokenData = await Spotify.initToken(args.authCode);
            var data = await new Spotify(tokenData).init();

            if (data && tokenData) {
                session.send('thanks! just a moment...');

                session.conversationData.args = args;
                session.conversationData.spotifyUser = data.userData;
                session.conversationData.spotifyToken = tokenData;

                if (!data.playlist) {
                    session.beginDialog('CreatePlaylist', { name: process.env.SPOTIFY_QUEUE_PLAYLIST_NAME });
                } else {
                    session.conversationData.spotifyPlaylist = data.playlist;
                    session.conversationData.spotifyBotPlaylist = data.playlist;
                    next();
                }

            } else {
                session.send('something went wrong ;(... restarting over.');
                session.replaceDialog('AuthorizeSpotify');
            }
        } catch (err) {
            session.send('opps... bot make bobo ' + emoji.get('face_with_head_bandage'));
            console.log(err);
        }
    },
    function(session, results) {
        session.beginDialog('SpotifySetDevice');
    },
    async function(session, results) {
        var args = session.conversationData.args;
        if (args && args.dialog) {
            session.send('all set! now where were we...');
            session.beginDialog(args.dialog, args && args.dialogArgs);
        } else {
            session.endDialog('all set!');
        }
    }
]);

bot.dialog('AuthorizeSpotify', [
    function(session, args) {
        session.dialogData.resumeDialog = args.options && args.options.resumeDialog;
        session.dialogData.dialogArgs = args.options && args.options.dialogArgs;
        Prompts.confirm(session, args.message ? args.message : 'do you want me to use your spotify account to play music?');
    },
    function(session, results) {
        if (results.response) {
            var state = Buffer.from(JSON.stringify({
                address: session.message.address,
                dialog: session.dialogData.resumeDialog,
                args: session.dialogData.dialogArgs
            })).toString('base64');

            session.send('good. click below to authorize me...');
            var msg = new Message(session)
                .attachments([
                    new HeroCard(session)
                        .title("accounts.spotify.com")
                        .subtitle("Authorize bot to play music, search and do some cool stuff.")
                        .tap(CardAction.openUrl(session, 'https://accounts.spotify.com/authorize?client_id=933adf0420af4eecb7d70cc8c7687d70&response_type=code&redirect_uri='+encodeURIComponent(process.env.SPOTIFY_REDIRECT_URI)+'&scope=user-read-playback-state+user-modify-playback-state+playlist-read-private+playlist-modify-public+user-library-read+user-read-private+user-read-email+user-follow-modify+playlist-read-collaborative+playlist-modify-private+user-library-modify+user-read-birthdate+user-follow-read+user-top-read&state=' + encodeURIComponent(state)))
                ]);

            session.endDialog(msg);

        } else {
            session.endDialog('k nvm');
        }
    }
]).triggerAction({
    matches: /^(?:\@[\w-_]+\s+)?(?:turn on|setup|init|start|load|reset)/i
}).cancelAction('cancelAuthorizeSpotify', 'k', { matches: /^(?:\@[\w-_]+\s+)?(?:cancel|nvm|nevermind)/i });

bot.dialog('DeleteUserData', function(session, args) {
    session.conversationData = {};
    session.userData = {};

    session.endDialog(args.message ? args.message : [
        'all clear! ;)',
        'cleared',
        'shutting down... (y)',
        'done!',
        'bye',
        'k bye'
    ]);
}).triggerAction({
    matches: /^(?:\@[\w-_]+\s+)?(?:terminate|exit|shutdown|turn off|quit|leave)/i
});