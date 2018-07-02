<h1 align="center">
  <img src="./icon.png" width="200px" /><br>
  Sbotify Music Player Bot
  <br><br>
  <img src="https://github.com/lodev09/sbotify/blob/master/demo.gif?raw=true" width="500px">
</h1>

## About
A bot that plays music and playlists built using:
- [Spotify Web API](https://developer.spotify.com/web-api/)
- [Microsoft Bot Framework](https://dev.botframework.com/)
- [Microsoft BotBuilder SDK](https://github.com/Microsoft/BotBuilder)
- [LUIS](https://www.luis.ai)

## Development

### Installation
Clone and install:
```bash
$ git clone https://github.com/lodev09/sbotify.git
$ cd sbotify
$ npm install
```
Create the `.env` file and configure your local environment. [Learn more](https://github.com/motdotla/dotenv#usage)
```dosini
PORT=3978
MICROSOFT_APP_ID=your_microsoft_app_id
MICROSOFT_APP_PASSWORD=your_microsoft_password
SPOTIFY_QUEUE_PLAYLIST_NAME=your_queue_playlist
SPOTIFY_REDIRECT_URI=your_spotify_redirect_uri
LOUIS_MODEL=your_louis_model_uri
```
```bash
$ npm run dev
```

Download and run the [Bot Framework Emulator](https://github.com/microsoft/botframework-emulator) to do your test and debug sbotify

## Channels
Currently on:
- [Skype](https://join.skype.com/bot/620a26bb-45c2-45bf-8e51-062d7c1b2747)
- [Messenger](https://www.messenger.com/t/1282802558506132)

## Credits
Feedback and PRs are welcome!

## License

The MIT License.

See [LICENSE](LICENSE)
