(() => {
  const CONTRACT_ADDRESS = "0x32461873e1fA13170382f755A5b86F1409249d49";
  const MAINNET_ID = 1;
  const IPFS_GATEWAY = "https://magenta-familiar-grouse-918.mypinata.cloud/ipfs/";

  const ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function owner() view returns (address)",
    "function ownerOf(uint256) view returns (address)",
    "function tokenURI(uint256) view returns (string)",
    "function ethBalance(uint256) view returns (uint256)",
    "function assetValueUSD(uint256) view returns (uint256)",
    "function getFundingProgress(uint256) view returns (uint256)",
    "function deposit(uint256) payable",
    "function withdraw(uint256 tokenId, uint256 amount)"
  ];

  let provider, signer, contract, chainId, account;
  const $ = id => document.getElementById(id);
  const log = m => { $("log").textContent = `${new Date().toLocaleTimeString()}  ${m}\n` + $("log").textContent; };
  const setTxt = (id, v) => $(id).textContent = v ?? "—";
  const setCode = (id, v) => $(id).textContent = v || "—";

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

  const ipfsToHttp = uri => uri?.startsWith?.("ipfs://") ? IPFS_GATEWAY + uri.slice(7) : uri;

  const refreshLinks = () => {
    $("linkEtherscan").href = `https://etherscan.io/address/${CONTRACT_ADDRESS}`;
    $("linkOpenSea").href = `https://opensea.io/assets/ethereum/${CONTRACT_ADDRESS}/0`;
    setCode("ctr", CONTRACT_ADDRESS);
  };
  refreshLinks();

  const validateDeposit = () => {
    const val = parseFloat($("ethAmount").value);
    const valid = !isNaN(val) && val > 0;
    $("btnDeposit").disabled = !(valid && chainId === MAINNET_ID);
  };

  async function connect() {
    if (!window.ethereum) return alert("Wallet not found");
    showLoading("btnConnect");
    try {
      provider = new ethers.BrowserProvider(window.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      account = await signer.getAddress();

      const net = await provider.getNetwork();
      chainId = Number(net.chainId);
      contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

      let contractOwner = null;
      try { contractOwner = await contract.owner(); } catch (e) { log(`owner() failed: ${e.reason||e.message}`); }
      window.__contractOwner = contractOwner;

      setCode("connStatus", "Connected");
      setCode("acct", account);
      setCode("net", `${net.name} (${chainId})`);
      log("Connected");

      let n="—",s="—"; 
      try{n=await contract.name();}catch{} 
      try{s=await contract.symbol();}catch{}
      setTxt("nftName", n); setTxt("nftSymbol", s);

      updateButtons();
      validateDeposit();
      if (chainId !== MAINNET_ID) log(`Switch to Mainnet (ID 1) to deposit/withdraw`);
    } catch(e){ log(`Connect error: ${e.reason||e.message}`); }
    finally{ hideLoading("btnConnect"); }
  }

  const updateButtons = () => {
    const onMainnet = chainId === MAINNET_ID;
    const depositBtn = $("btnDeposit");
    depositBtn.disabled = !onMainnet;
    depositBtn.innerHTML = onMainnet 
      ? `Deposit <span class="spinner-border spinner-border-sm ms-1" style="display:none"></span>`
      : `Mainnet only <span class="spinner-border spinner-border-sm ms-1" style="display:none"></span>`;
  };

  async function loadToken() {
    const tid = Math.floor(Number($("tokenId").value.trim()));
    if (!Number.isInteger(tid) || tid < 0) return alert("Invalid token ID");
    showLoading("btnLoad");
    try {
      const [owner, uri] = await Promise.all([
        contract.ownerOf(tid).catch(() => null),
        contract.tokenURI(tid).catch(() => "")
      ]);
      if (!owner) throw new Error("Token not minted");

      setCode("ownerAddr", owner);
      setCode("tokenUri", uri || "—");

      let meta=null; const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),8000);
      try {
        const u=ipfsToHttp(uri);
        if(u){const r=await fetch(u,{signal:ctrl.signal}); if(r.ok) meta=await r.json();}
      }catch{}finally{clearTimeout(to);}

      if(meta?.image)$("nftImage").src=ipfsToHttp(meta.image); else $("nftImage").removeAttribute("src");
      $("nftImage").alt = meta?.name ? `NFT: ${meta.name}` : `Vault NFT #${tid}`;

      await refreshStats();
      log(`Loaded token ${tid}`);
      $("linkOpenSea").href=`https://opensea.io/assets/ethereum/${CONTRACT_ADDRESS}/${tid}`;

      const btn=$("btnWithdraw");
      if(window.__contractOwner && account && window.__contractOwner.toLowerCase()===account.toLowerCase()){
        btn.style.display="block"; btn.disabled=(chainId!==MAINNET_ID);
      } else { btn.style.display="none"; }

      validateDeposit();
    } catch(e){
      setCode("ownerAddr","—"); setCode("tokenUri","—"); $("nftImage").removeAttribute("src");
      setTxt("ethDeposited","0"); setTxt("targetUsd","0.00");
      $("progressPct").textContent="0"; $("progressBar").style.width="0%";
      log(`Load error: ${e.reason||e.message}`);
    } finally{ hideLoading("btnLoad"); }
  }

  async function refreshStats(){
    const tid=Math.floor(Number($("tokenId").value.trim()));
    if(!Number.isInteger(tid)||tid<0)return;
    showLoading("btnRefresh");
    try{
      const [wei,usdCents,permille]=await Promise.all([
        contract.ethBalance(tid).catch(()=>0n),
        contract.assetValueUSD(tid).catch(()=>0n),
        contract.getFundingProgress(tid).catch(()=>0n)
      ]);
      setTxt("ethDeposited",ethers.formatEther(wei));
      const dollars=Number(usdCents)/100;
      setTxt("targetUsd",dollars.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
      const pct=Math.min(100,Number(permille)/10);
      $("progressPct").textContent=pct.toFixed(1);
      $("progressBar").style.width=pct+"%";
    }catch(e){log(`Refresh error: ${e.reason||e.message}`);}
    finally{hideLoading("btnRefresh");}
  }

  async function doDeposit(){
    if(chainId!==MAINNET_ID)return alert("Switch to Mainnet");
    const tid=Math.floor(Number($("tokenId").value.trim()));
    if(!Number.isInteger(tid)||tid<0)return alert("Invalid token ID");
    const amt=$("ethAmount").value.trim();
    if(!amt||isNaN(amt)||Number(amt)<=0)return alert("Enter valid ETH amount");
    let value; try{value=ethers.parseEther(amt);}catch{return alert("Invalid amount");}
    showLoading("btnDeposit");
    try{
      const bal=await provider.getBalance(account);
      if(bal<value)return alert(`Insufficient balance: ${ethers.formatEther(bal)} ETH`);
      let gas; try{gas=await contract.deposit.estimateGas(tid,{value});}
      catch(e){return log(`Gas estimate failed: ${e.reason||e.message}`);}
      const tx=await contract.deposit(tid,{value,gasLimit:gas*12n/10n});
      log(`Tx ${tx.hash}`); await tx.wait(); log("Deposit confirmed");
      $("ethAmount").value=""; await refreshStats(); validateDeposit();
    }catch(e){log(`Deposit failed: ${e.reason||e.message}`);}
    finally{hideLoading("btnDeposit");}
  }

  async function doWithdraw(){
    if(chainId!==MAINNET_ID)return alert("Switch to Mainnet");
    if(!window.__contractOwner||account.toLowerCase()!==window.__contractOwner.toLowerCase())
      return alert("Only contract owner can withdraw");
    const tid=Math.floor(Number($("tokenId").value.trim()));
    if(!Number.isInteger(tid)||tid<0)return alert("Invalid token ID");
    const amt=$("withdrawAmt").value.trim();
    if(!amt||isNaN(amt)||Number(amt)<=0)return alert("Enter ETH amount");
    const value=ethers.parseEther(amt);
    const bal=await contract.ethBalance(tid);
    if(value>bal)return alert("Amount exceeds vault balance");
    showLoading("btnWithdraw");
    try{
      const tx=await contract.withdraw(tid,value);
      log(`Withdraw tx ${tx.hash}`); await tx.wait();
      log("Withdraw confirmed"); $("withdrawAmt").value=""; await refreshStats();
    }catch(e){log(`Withdraw failed: ${e.reason||e.message}`);}
    finally{hideLoading("btnWithdraw");}
  }

  $("ethAmount").addEventListener("input", validateDeposit);

  $("btnMax").onclick = async () => {
    if (!provider || !account) return alert("Connect wallet first");
    showLoading("btnMax");
    try {
      const tid = Math.floor(Number($("tokenId").value.trim()));
      if (!Number.isInteger(tid) || tid < 0) return;

      const bal = await provider.getBalance(account);
      let max = bal;

      try {
        const gas = await contract.deposit.estimateGas(tid, { value: bal });
        const feeData = await provider.getFeeData();
        const gasCost = gas * (feeData.maxFeePerGas || 0n);
        max = bal - gasCost;
      } catch (e) {
        max = (bal * 95n) / 100n;
      }

      const maxEth = ethers.formatEther(max > 0n ? max : 0n);
      $("ethAmount").value = Number(maxEth).toFixed(6);
      validateDeposit();
    } catch (e) {
      log("Max failed");
    } finally {
      hideLoading("btnMax");
    }
  };

  $("btnConnect").onclick = connect;
  $("btnLoad").onclick = loadToken;
  $("btnRefresh").onclick = refreshStats;
  $("btnDeposit").onclick = doDeposit;
  $("btnWithdraw").onclick = doWithdraw;

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => { log("Account changed"); connect(); });
    window.ethereum.on?.("chainChanged", () => location.reload());
  }

  updateButtons();
  validateDeposit();
})();
