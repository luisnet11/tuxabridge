// ==========================================
// CONFIGURACIÓN DE RED Y TOKENS
// ==========================================
const CONFIG = {
    engineAccount: "0x4e4542e3.c.aurora",
    chainId: 1313161955,
    rpcUrl: "https://0x4e4542e3.rpc.aurora-cloud.dev",
    nearNodeUrl: "https://rpc.mainnet.near.org",
    tokens: {
        NEAR: { // Usaremos wrap.near como el equivalente al ERC-20
            nearContract: "wrap.near",
            evmContract: "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
            decimals: 24
        },
        USDT: {
            nearContract: "usdt.tether-token.near",
            evmContract: "0x80da25da4d783e57d2fcda0436873a193a4beccf",
            decimals: 6
        }
    }
};

let nearWallet = null;
let evmSigner = null;
let nearAccountId = null;
let evmAddress = null;

// ==========================================
// 1. CONEXIÓN BILLETERA NEAR (Soporta Meteor)
// ==========================================
async function initNear() {
    const { connect, keyStores, WalletConnection } = window.nearApi;
    const nearConfig = {
        networkId: "mainnet",
        nodeUrl: CONFIG.nearNodeUrl,
        walletUrl: "https://app.mynearwallet.com",
        keyStore: new keyStores.BrowserLocalStorageKeyStore()
    };
    const near = await connect(nearConfig);
    
    // Prioriza la extensión de Meteor si Mises la inyecta
    if (window.near && window.near.isMeteor) {
        nearWallet = window.near;
        if (nearWallet.isSignedIn()) nearAccountId = nearWallet.getAccountId();
    } else {
        nearWallet = new WalletConnection(near, "AuroraBridge");
        if (nearWallet.isSignedIn()) nearAccountId = nearWallet.getAccountId();
    }
    
    updateUI();
}
window.onload = initNear;

async function connectNear() {
    try {
        if (!nearAccountId) {
            if (window.near && window.near.isMeteor) {
                await window.near.requestSignIn({ contractId: CONFIG.engineAccount });
                nearAccountId = window.near.getAccountId();
            } else {
                nearWallet.requestSignIn(CONFIG.engineAccount, "Aurora Bridge");
                return; // La web recargará tras MyNearWallet
            }
        } else {
            nearWallet.signOut();
            nearAccountId = null;
        }
        updateUI();
    } catch (e) {
        showMessage("Error al conectar NEAR", true);
    }
}

// ==========================================
// 2. CONEXIÓN BILLETERA EVM (MetaMask)
// ==========================================
async function connectEVM() {
    if (window.ethereum) {
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            await provider.send("eth_requestAccounts", []);
            evmSigner = await provider.getSigner();
            evmAddress = await evmSigner.getAddress();
            
            const network = await provider.getNetwork();
            if(Number(network.chainId) !== CONFIG.chainId) {
                showMessage("Cambia a tu Virtual Chain en MetaMask", true);
            }
            updateUI();
        } catch (error) {
            showMessage("Conexión EVM rechazada", true);
        }
    } else {
        showMessage("No se detectó MetaMask en Mises", true);
    }
}

// ==========================================
// 3. ACTUALIZACIÓN DE UI Y LECTURA DE SALDOS
// ==========================================
async function updateUI() {
    document.getElementById("near-account").innerText = nearAccountId || "No conectado";
    document.getElementById("btn-near").innerText = nearAccountId ? "Desconectar" : "Conectar NEAR";
    
    document.getElementById("evm-account").innerText = evmAddress || "No conectado";
    document.getElementById("btn-evm").innerText = evmAddress ? "Desconectar" : "Conectar EVM";

    await updateBalances();
}

async function updateBalances() {
    const selectedAsset = document.getElementById("asset-select").value;
    const token = CONFIG.tokens[selectedAsset];

    // Reset saldos
    document.getElementById("near-balance").innerText = `Cargando...`;
    document.getElementById("evm-balance").innerText = `Cargando...`;

    // Saldo NEAR (NEP-141)
    if (nearAccountId) {
        try {
            const provider = new window.nearApi.providers.JsonRpcProvider({ url: CONFIG.nearNodeUrl });
            const argsBase64 = btoa(JSON.stringify({ account_id: nearAccountId }));
            const res = await provider.query({
                request_type: "call_function",
                account_id: token.nearContract,
                method_name: "ft_balance_of",
                args_base64: argsBase64,
                finality: "optimistic"
            });
            const balanceStr = JSON.parse(new TextDecoder().decode(new Uint8Array(res.result)));
            const balanceFormatted = ethers.formatUnits(balanceStr, token.decimals);
            document.getElementById("near-balance").innerText = `Saldo: ${parseFloat(balanceFormatted).toFixed(4)} ${selectedAsset}`;
        } catch (e) {
            document.getElementById("near-balance").innerText = "Saldo: 0.00";
        }
    } else {
        document.getElementById("near-balance").innerText = "Saldo: 0.00";
    }

    // Saldo EVM (ERC-20)
    if (evmAddress) {
        try {
            const rpcProvider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
            const abi = ["function balanceOf(address owner) view returns (uint256)"];
            const contract = new ethers.Contract(token.evmContract, abi, rpcProvider);
            const balanceWei = await contract.balanceOf(evmAddress);
            const balanceFormatted = ethers.formatUnits(balanceWei, token.decimals);
            document.getElementById("evm-balance").innerText = `Saldo: ${parseFloat(balanceFormatted).toFixed(4)} ${selectedAsset}`;
        } catch (e) {
            document.getElementById("evm-balance").innerText = "Saldo: 0.00";
        }
    } else {
         document.getElementById("evm-balance").innerText = "Saldo: 0.00";
    }
}

// ==========================================
// 4. FUNCIONES DE TRANSFERENCIA
// ==========================================
async function depositToVirtualChain() {
    if (!nearAccountId || !evmAddress) return showMessage("Conecta ambas billeteras primero", true);
    const amount = document.getElementById("amount").value;
    if (!amount || amount <= 0) return showMessage("Ingresa una cantidad válida", true);

    const asset = document.getElementById("asset-select").value;
    const token = CONFIG.tokens[asset];
    
    try {
        showMessage("Aprueba la transacción en NEAR...");
        const amountWei = ethers.parseUnits(amount.toString(), token.decimals).toString();

        const tx = {
            receiverId: token.nearContract,
            actions: [{
                type: "FunctionCall",
                params: {
                    methodName: "ft_transfer_call",
                    args: {
                        receiver_id: CONFIG.engineAccount,
                        amount: amountWei,
                        msg: evmAddress
                    },
                    gas: "300000000000000",
                    deposit: "1"
                }
            }]
        };

        // Soporte para Meteor Inyectado o API Web
        if (window.near && window.near.isMeteor) {
            await window.near.signAndSendTransaction(tx);
            showMessage("¡Depósito exitoso!");
            setTimeout(updateBalances, 3000);
        } else {
            await nearWallet.account().signAndSendTransaction(tx); // Redirige a Web Wallet
        }
    } catch (e) {
        showMessage("Error en el depósito. Revisa tu saldo.", true);
    }
}

async function withdrawToNear() {
    if (!nearAccountId || !evmAddress) return showMessage("Conecta ambas billeteras primero", true);
    const amount = document.getElementById("amount").value;
    if (!amount || amount <= 0) return showMessage("Ingresa una cantidad válida", true);

    const asset = document.getElementById("asset-select").value;
    const token = CONFIG.tokens[asset];

    try {
        showMessage("Firma el retiro en MetaMask...");
        const abi = ["function withdraw(string memory receiver_id, uint256 amount) public"];
        const contract = new ethers.Contract(token.evmContract, abi, evmSigner);
        const amountWei = ethers.parseUnits(amount.toString(), token.decimals);

        const tx = await contract.withdraw(nearAccountId, amountWei);
        showMessage("Procesando retiro en Virtual Chain...");
        await tx.wait();
        
        showMessage("¡Retiro exitoso!");
        setTimeout(updateBalances, 3000);
    } catch (e) {
        showMessage("Transacción fallida. Verifica saldo y gas.", true);
    }
}

function showMessage(msg, isError = false) {
    const el = document.getElementById("bridge-msg");
    el.innerText = msg;
    el.style.color = isError ? "#ef4444" : "#4ade80";
                        }
