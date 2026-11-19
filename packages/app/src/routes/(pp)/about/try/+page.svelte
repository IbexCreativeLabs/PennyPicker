<svelte:head><title>Try it · PennyPicker</title></svelte:head>

<header class="ab-head">
	<p class="kicker">Try it</p>
	<h1>Your first trade in 5 minutes</h1>
	<p class="lead">Uses BCH Chipnet, a test network. The coins are free and have no value.</p>
</header>

<div class="pp-card">
	<ol class="ab-steps">
		<li>
			<strong>Get a wallet</strong>
			<p>Open <a href="https://cashonize.com" target="_blank" rel="noopener">Cashonize</a> (web, extension or app) and create a wallet. In <em>Settings</em>, switch the network to <strong>Chipnet</strong>.</p>
		</li>
		<li>
			<strong>Get test BCH</strong>
			<p>Copy your Chipnet address and request coins from the <a href="https://tbch.googol.cash" target="_blank" rel="noopener">Chipnet faucet</a>.</p>
		</li>
		<li>
			<strong>Connect</strong>
			<p>Open <a href="/wallet">Wallet</a>, press <em>Connect Cashonize</em>, then scan the QR code or use <em>Open in Cashonize web</em>, and approve.</p>
		</li>
		<li>
			<strong>Trade now</strong>
			<p>On the <a href="/">Exchange</a>, choose <em>Trade now → Sell BCH</em>, enter <span class="mono">0.001</span> and review. You sell into the best bid and receive test PUSD.</p>
		</li>
		<li>
			<strong>Place your own order</strong>
			<p>In <em>Limit order</em>, pick a side and a BPS, such as <span class="mono">+25</span>. Your price follows BCH/USD automatically. Cancel it any time under <em>My orders</em>.</p>
		</li>
	</ol>
</div>

<div class="ab-grid" style="margin-top: 1rem">
	<div class="pp-card ab-card">
		<h3><span class="ab-icon">✓</span>Nothing happens by surprise</h3>
		<p>Cashonize shows every transaction before you sign, and nothing is sent until you press <em>Broadcast</em>.</p>
	</div>
	<div class="pp-card ab-card">
		<h3><span class="ab-icon">↻</span>"Someone traded first"</h3>
		<p>If another trade lands just before yours, nothing is lost: press <em>Rebuild</em> and sign again.</p>
	</div>
	<div class="pp-card ab-card">
		<h3><span class="ab-icon">?</span>Stuck?</h3>
		<p>Use the <strong>Chat</strong> button at the bottom right to ask the community for help or test PUSD.</p>
	</div>
</div>

<p style="margin-top: 1.25rem"><a class="pp-btn pp-btn-primary" href="/">Open the Exchange →</a></p>
