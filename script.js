(() => {
  const CONTRACT_ADDRESS = "0x434C173a069e1cCE3Ec994adDcF375c6599e166E";
  const MAINNET_ID = 1;
  const IPFS_GATEWAY = "https://magenta-familiar-grouse-918.mypinata.cloud/ipfs/";

  const ABI_ASSET = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function ownerOf(uint256) view returns (address)",
    "function tokenURI(uint256) view returns (string)",
    "function token(uint256) view returns (address)",
    "function valueUsdCents(uint256) view returns (uint256)"
  ];

  const ABI_ERC20 = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)"
  ];

  let provider, contract, chainId;
  const $ = id => document.getElementById(id);
  const log = m => { $("log").textContent = `${new Date().toLocaleTimeString()}  ${m}\n` + $("log").textContent; };
  const setTxt = (id, v) => $(id).textContent = v ?? "—";
  const setCode = (id, v) => $(id).textContent = v || "—";
  const ipfsToHttp = uri => uri?.startsWith?.("ipfs://") ? IPFS_GATEWAY + uri.slice(7) : uri;

  const showLoading = btnId => {
    const b = $(btnId); b.disabled = true;
    const s = b.querySelector('.spinner-border');
    if (s) s.style.display = 'inline-block';
  };
  const hideLoading = btnId => {
    const b = $(btnId); b.disabled = false;
    const s = b.querySelector('.spinner-border');
    if (s) s.style.display = 'none';
  };

  const initProvider = () => {
    if (!provider) {
      provider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
      contract = new ethers.Contract(CONTRACT_ADDRESS, ABI_ASSET, provider);
      chainId = MAINNET_ID;
      setCode("ctr", CONTRACT_ADDRESS);
      $("linkEtherscan").href = `https://etherscan.io/address/${CONTRACT_ADDRESS}`;
    }
  };

  async function connect() {
    if (!window.ethereum) return alert("Wallet not found");
    showLoading("btnConnect");
    try {
      const walletProvider = new ethers.BrowserProvider(window.ethereum, "any");
      await walletProvider.send("eth_requestAccounts", []);
      const signer = await walletProvider.getSigner();
      const account = await signer.getAddress();
      const net = await walletProvider.getNetwork();
      chainId = Number(net.chainId);
      provider = walletProvider;
      contract = new ethers.Contract(CONTRACT_ADDRESS, ABI_ASSET, signer);
      setCode("connStatus", "Connected");
      setCode("acct", account);
      setCode("net", `${net.name} (${chainId})`);
      setCode("ctr", CONTRACT_ADDRESS);
      $("linkEtherscan").href = `https://etherscan.io/address/${CONTRACT_ADDRESS}`;
      log("Wallet connected");
      if (chainId !== MAINNET_ID) log("Warning: switch to Mainnet");
    } catch(e) { log(`Connect error: ${e.reason||e.message}`); }
    finally { hideLoading("btnConnect"); }
  }

  async function loadToken() {
    initProvider();
    const tid = Math.floor(Number($("tokenId").value.trim()));
    if (!Number.isInteger(tid) || tid < 0) return alert("Invalid token ID");
    showLoading("btnLoad");
    try {
      const [owner, uri, valueCents, rwatAddr] = await Promise.all([
        contract.ownerOf(tid).catch(() => null),
        contract.tokenURI(tid).catch(() => ""),
        contract.valueUsdCents(tid).catch(() => 0n),
        contract.token(tid).catch(() => null)
      ]);
      if (!owner) throw new Error("Token not minted");

      setCode("ownerAddr", owner);
      setCode("tokenUri", uri || "—");

      const dollars = Number(valueCents) / 100;
      setTxt("assetValue", `$${dollars.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`);

      // Load IPFS metadata
      let meta = null;
      try {
        const u = ipfsToHttp(uri);
        if (u) {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(u, {signal: ctrl.signal});
          clearTimeout(to);
          if (r.ok) meta = await r.json();
        }
      } catch {}

      if (meta?.image) $("nftImage").src = ipfsToHttp(meta.image);
      else $("nftImage").removeAttribute("src");
      $("nftImage").alt = meta?.name ? `NFT: ${meta.name}` : `RWA Asset #${tid}`;

      $("linkOpenSea").href = `https://opensea.io/assets/ethereum/${CONTRACT_ADDRESS}/${tid}`;

      // Load RWAT token stats
      if (rwatAddr && rwatAddr !== "0x0000000000000000000000000000000000000000") {
        setCode("rwatAddr", rwatAddr);
        $("linkUniswap").href = `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=ETH&outputCurrency=${rwatAddr}`;
        $("linkUniswap").style.display = "inline-block";

        const rwat = new ethers.Contract(rwatAddr, ABI_ERC20, provider);
        const [totalSupply, rwatName, rwatSymbol] = await Promise.all([
          rwat.totalSupply().catch(() => 0n),
          rwat.name().catch(() => ""),
          rwat.symbol().catch(() => "")
        ]);

        setTxt("rwatName", rwatName);
        setTxt("rwatSymbol", rwatSymbol);
        setTxt("rwatTotal", (Number(totalSupply) / 1e18).toLocaleString());

        // Find pool by checking pool balance of RWAT
        // Try to get pool address from known Uniswap factory
        // We read it from the broadcast data: pool is the first pool created for this RWAT
        // Simpler: check pool balance via Uniswap factory lookup
        await refreshSupplyStats(rwatAddr, totalSupply);
      } else {
        setCode("rwatAddr", "—");
        $("linkUniswap").style.display = "none";
      }

      log(`Loaded asset #${tid}`);
    } catch(e) {
      log(`Load error: ${e.reason||e.message}`);
    } finally { hideLoading("btnLoad"); }
  }

  async function refreshSupplyStats(rwatAddr, totalSupply) {
    // Derive Uniswap V3 pool address via factory
    // Factory: 0x1F98431c8aD98523631AE4a59f267346ea31F984
    // computeAddress(token0, token1, fee=3000)
    const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
    const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const FEE = 3000;

    const ABI_FACTORY = ["function getPool(address,address,uint24) view returns (address)"];
    try {
      const factory = new ethers.Contract(FACTORY, ABI_FACTORY, provider);
      const poolAddr = await factory.getPool(WETH, rwatAddr, FEE);

      if (poolAddr && poolAddr !== "0x0000000000000000000000000000000000000000") {
        setCode("poolAddr", poolAddr);
        $("linkPoolEtherscan").href = `https://etherscan.io/address/${poolAddr}`;
        $("linkPoolEtherscan").style.display = "inline";

        const rwat = new ethers.Contract(rwatAddr, ABI_ERC20, provider);
        const poolBalance = await rwat.balanceOf(poolAddr).catch(() => 0n);
        const sold = totalSupply - poolBalance;
        const soldHuman = Number(sold) / 1e18;
        const totalHuman = Number(totalSupply) / 1e18;
        const availHuman = Number(poolBalance) / 1e18;
        const pct = totalHuman > 0 ? Math.min(100, (soldHuman / totalHuman) * 100) : 0;

        setTxt("rwatAvail", availHuman.toLocaleString(undefined, {maximumFractionDigits: 2}));
        setTxt("rwatSold", soldHuman.toLocaleString(undefined, {maximumFractionDigits: 2}));
        $("progressPct").textContent = pct.toFixed(1);
        $("progressBar").style.width = pct + "%";
      }
    } catch(e) { log(`Pool lookup error: ${e.reason||e.message}`); }
  }

  $("btnConnect").onclick = connect;
  $("btnLoad").onclick = loadToken;

  // Init read-only provider on load
  initProvider();
  setCode("ctr", CONTRACT_ADDRESS);
  $("linkEtherscan").href = `https://etherscan.io/address/${CONTRACT_ADDRESS}`;

  if (window.ethereum) {
    window.ethereum.on?.("chainChanged", () => location.reload());
  }
})();
