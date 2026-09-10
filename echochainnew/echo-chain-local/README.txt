ECHO CHAIN — LOCAL PARTY GAME
==============================

This is a standalone version of the game. It runs on your own computer
using Node.js — no Claude, no account, no internet service required
once Node is installed. It works for up to about 10 players.


WHAT YOU NEED
-------------
Node.js installed on the computer that will host the game.
If you don't have it: https://nodejs.org (download the "LTS" version,
install it like any normal program).

Everyone else just needs a phone or laptop with a web browser — they
don't need to install anything.


HOW TO RUN IT
-------------
1. Unzip this folder somewhere you'll remember.
2. Open a terminal / command prompt in this folder.
     Windows: open the folder, type "cmd" in the address bar, press Enter.
     Mac: right-click the folder > "New Terminal at Folder"
          (or open Terminal and type "cd " then drag the folder in).
3. Run:
     node server.js
4. You'll see something like:

     🎮  Echo Chain is running!
     ─────────────────────────
     On this computer:   http://localhost:8080
     Same WiFi network:  http://192.168.1.42:8080

5. Open the "localhost" address yourself, in your own browser, to host.
6. Send the "Same WiFi network" address to your friends — everyone
   needs to be connected to the same WiFi as you. They open it in
   their own browser and join with the invite code.
7. To stop hosting, go back to the terminal and press Ctrl+C.


THINGS TO KNOW
---------------
- Everything resets when you stop the server. There's no save file —
  every time you run "node server.js" it's a brand new game.

- Microphone recording only works over "localhost" or HTTPS in most
  browsers, as a security rule that isn't specific to this game. That
  means:
    * You (the host, on localhost) can record your voice normally.
    * Friends joining over the WiFi address will usually be blocked
      from using the mic, and will automatically get the "type your
      impression instead" option so the round still works.
  If you want everyone to be able to actually record their voice, you
  need HTTPS. The easiest way is a free tunneling tool like ngrok
  (https://ngrok.com) — run "ngrok http 8080" alongside the server and
  share the https:// link it gives you instead of the WiFi address.
  That also lets people outside your WiFi join, not just people in
  the same house.

- If port 8080 is already used by something else on your computer,
  run it on a different port instead:
     Mac/Linux:   PORT=8081 node server.js
     Windows:     set PORT=8081 && node server.js

- Up to ~10 players is the sweet spot for the drawing-chain round —
  more than that and the round can start to feel long, since it
  passes around a step for every player.


WANT A LINK THAT WORKS FOR ANYONE, ANYWHERE — NOT JUST YOUR WIFI?
-------------------------------------------------------------------
Running "node server.js" on your own computer only reaches devices on
your WiFi. For a real public link that works for friends anywhere,
and doesn't need your computer to stay on, deploy this same folder to
a free hosting service. It already has a package.json, so most hosts
detect it automatically.

Recommended: Render.com (free, no credit card, real Node server —
it just goes to sleep after inactivity and takes ~30s to wake back up
when someone opens the link, which is fine for a party game):

  1. Put this folder in a GitHub repo. If you don't use git, GitHub's
     website lets you create a repo and drag-and-drop these files in
     (github.com > New repository > "uploading an existing file").
  2. Go to render.com, sign up free (GitHub login is easiest).
  3. Click "New +" > "Web Service", pick the repo you just made.
  4. Leave the Build Command blank (or "npm install") and set the
     Start Command to: node server.js
  5. Click "Create Web Service". After a minute or two you'll get a
     link like https://echo-chain-yourname.onrender.com — that's your
     permanent, worldwide link. Open it yourself to host, send it to
     anyone to join.

This also fixes the microphone limitation mentioned above, since
Render serves everything over HTTPS — every player gets real voice
recording, not just the host.

If you just want a link for tonight and don't want to set up hosting,
run a free tunnel called ngrok (ngrok.com) alongside the server:
     ngrok http 8080
It prints an https:// link that works for anyone right away — but
your computer needs to stay on, and the link changes every time you
restart ngrok.


FILES IN THIS FOLDER
---------------------
server.js        The local game server (Node.js).
public/index.html  The game itself — the page everyone plays in their browser.
package.json     Lets Node/hosting platforms know how to run this project.
README.txt       This file.


CHARGING FOR ACCESS (OPTIONAL) — MAKE PEOPLE PAY TO HOST
-----------------------------------------------------------
By default hosting is free. If you want people to pay once before they
can host a lobby (joining a lobby with a code always stays free, no
matter what), you can turn on a simple paywall powered by Stripe.

What this does: a "Buy access" button opens a real Stripe payment
page. After paying, the game gives that browser an access code and
remembers it — no need to pay again on that device. There's no extra
database to manage: Stripe itself is the permanent record of who paid.

Setup:
  1. Make a free Stripe account at stripe.com. Stripe will eventually
     ask for business/bank details before it'll pay real money out to
     you, but you can build and test everything first without that.
  2. In the Stripe Dashboard, make sure you're in "Test mode" (toggle
     top-right), then go to Developers > API keys and copy the
     "Secret key" (starts with sk_test_...).
  3. Run "npm install" once in this folder (only needed for payments —
     it downloads Stripe's helper library).
  4. Set two environment variables when you start the server:
       Mac/Linux:
         STRIPE_SECRET_KEY=sk_test_... ACCESS_SECRET=some-long-random-phrase node server.js
       Windows (cmd):
         set STRIPE_SECRET_KEY=sk_test_...
         set ACCESS_SECRET=some-long-random-phrase
         node server.js
     ACCESS_SECRET can be anything — just make it long and don't
     change it later, or everyone's saved access codes will stop
     working.
  5. Optional: also set PRICE_CENTS (e.g. 500 = $5.00), CURRENCY
     (e.g. usd), and PRODUCT_NAME to customize the price and label.
  6. Open the game — you should now see a paywall before hosting.
     Test it with Stripe's fake test card: 4242 4242 4242 4242, any
     future expiry date, any 3-digit CVC.
  7. When you're ready to take real money, switch Stripe out of Test
     mode, copy your live secret key (sk_live_...), and use that as
     STRIPE_SECRET_KEY instead. Stripe will walk you through verifying
     your business/bank details the first time you do this.

If you deploy to Render (see above), set these same environment
variables in Render's dashboard under your service's "Environment"
tab instead of typing them in a terminal.

A note on limits: this is a lightweight, hobby-scale paywall meant to
stop casual freeloading among friends — it isn't hardened against
someone technical deliberately trying to bypass it. That's a
reasonable trade-off for a party game, just not something to build a
serious business on without more security work.
