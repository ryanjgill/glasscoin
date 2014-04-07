/* 
 * Vertcoin ticker for Glass 
 * Created with the help of the following tutorial:
 * http://okaysass.com/posts/14-03-16-tutorial-node-js-mirror-api-google-glass
 * Thanks Jonathan!
 */

// Standard modules
var http = require('http');
var url = require("url");
var fs = require('fs');
var moment = require('moment');

// Google API
var googleapis = require('googleapis');
var OAuth2Client = googleapis.OAuth2Client;

// dot templates
var dot = require('dot');

var cards = {
	"vtc": dot.template(fs.readFileSync("cards/vtc.html"))
};

// Load in the client configuration and attach to OAuth client
var config = require("./config.json");
var oauth2Client = new OAuth2Client(config.client_id, config.client_secret, config.redirect_url);

// Store global variables
var apiclient = null;
var user_card_ids = {};
var client_tokens = [];

// Attempt to load stored client tokens
try {
	var filedata = fs.readFileSync(".clienttokens.json");
	if (filedata) {
		client_tokens = JSON.parse(filedata.toString());
	}
} catch(e) {
	console.log("Info: failed to load .clienttokens.json, using blank array");
}

// read the connected users information from disk
googleapis.discover('mirror','v1').execute(function(err,client) {
	if (err) {
		console.warn("ERR: " + err.toString());
		return;
	}

	apiclient = client;

	// update cards
	getMarketData();

	// http server interface for adding clients
	http.createServer(function(req,res) {
		var u = url.parse(req.url, true)
		var s = u.pathname.split("/");

		if (s[1] == "oauth2callback") {
			oauth2Client.getToken(u.query.code, function(err,tokens) {
				if (err) {
					res.write("Oh no! Something went wrong! Looks like the token may be old. Try going back and doing it all again. The incident has been logged and Jonathan will be looking into it.");
					res.end();
					console.log(err);
				} else {
					client_tokens.push(tokens);
					fs.writeFileSync(".clienttokens.json", JSON.stringify(client_tokens,null,5));
					getMarketData();
				}
				res.writeHead(200, { 'Content-type': 'text/html' });
				fs.createReadStream('success.html').pipe(res);
			});
			return;
		}
		
		if (s[1] == "authorize") {
			var uri = oauth2Client.generateAuthUrl({
				access_type: 'offline',
				scope: 'https://www.googleapis.com/auth/glass.timeline',
				approval_prompt: 'force'
			});
			res.writeHead(302, { "Location": uri });
			res.end();
		} else {
			res.writeHead(200, { 'Content-type': 'text/html' });
			fs.createReadStream('index.html').pipe(res);
		}
	}).listen(8099);
});

// download the ticker data and build data
function getMarketData() {
	var data,
			market;

	http.get("http://coinmarketcap.northpole.ro/api/vtc.json", function(res) {
		data = "";
		res.on('data', function(chunk) {
			data += chunk;
		});
		res.on('end', function() {
			market = JSON.parse(data.toString());
			market.delta = (+market.change24.split(' %')[0]);
			market.timeDisplay = moment.unix(market.timestamp).format("dddd, MMMM Do YYYY, h:mm a");

			console.log('marketObj');
			console.log(market);

			updateCards({
				vtcLast: (+market.price).toFixed(2),
				vtcDelta: market.delta.toFixed(2),
				time: market.timeDisplay,
				marketCap: market.marketCap
			});
		});
	});
}

// update all the user cards
function updateCards(data) {
	var html = cards.vtc(data);
	
	for (i = 0; i < client_tokens.length; i++) {
		oauth2Client.credentials = client_tokens[i];
		apiclient.mirror.timeline.list({ "sourceItemId": "vertcoin", "isPinned": true })
		.withAuthClient(oauth2Client)
		.execute(function(err,data) {
			var apiCall;
			if (err) {
				console.log(err);
				return;
			}
			if (data && data.items.length > 0) {
				apiCall = apiclient.mirror.timeline.patch({"id": data.items[0].id }, {"html": html});
			} else {
				apiCall = apiclient.mirror.timeline.insert({
					"html": html,
					"menuItems": [
						{"action":"TOGGLE_PINNED"},
						{"action":"DELETE"}
					],
					"sourceItemId": "vertcoin"
				});
			}

			apiCall.withAuthClient(oauth2Client).execute(function(err,data) {
				console.log(err);
				console.log(data);
			});
		});
	}
}

// update every 15 minutes
setInterval(getMarketData, 60 * 1000 * 15);

