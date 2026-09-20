// ==========================================
// CONFIGURACIÓN DE RED Y TOKENS
// ==========================================
const CONFIG = {
    engineAccount: "0x4e4542e3.c.aurora",
    chainId: 1313161955,
    rpcUrl: "https://0x4e4542e3.rpc.aurora-cloud.dev",
    nearNodeUrl: "https://rpc.mainnet.near.org",
    tokens: {
        NEAR: {
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

let webWallet = null;
let nearWallet = null;
let evmSigner = null;
let nearAccountId = null;
let evmAddress = null;

// ==========================================
// 1. CONEXIÓN BILLETERA NEAR (Corrección MyNearWallet vs Meteor)
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
    webWallet = new WalletConnection(near, "AuroraBridge");

    // 1. Revisar si el usuario inició sesión con MyNearWallet
    if (webWallet.isSignedIn()) {
        nearWallet = webWallet;
        nearAccountId = webWallet.getAccountId();
    } 
    // 2. Si no hay sesión web, revisar si Meteor está inyectado y conectado
    else if (window.near && window.near.isMeteor && window.near.isSignedIn && window.near.isSignedIn()) {
        nearWallet = window.near;
        nearAccountId = window.near.getAccountId();
    }

    updateUI();
}

// Retraso de 500ms para permitir que Mises inyecte las extensiones correctamente
setTimeout(initNear, 500);

async function connectNear() {
    try {
        if (!nearAccountId) {
            // Intentar con Meteor primero si está disponible
            if (window.near && window.near.isMeteor) {
                try {
                    const res = await window.near.requestSignIn({ contractId: CONFIG.engineAccount });
                    if (res) {
                        nearWallet = window.near;
                        nearAccountId = window.near.getAccountId();
                        updateUI();
                        return; // Detiene el código si Meteor funcionó
                    }
                } catch (e) {
                    console.log("Meteor cancelado o falló, redirigiendo a MyNearWallet...");
                }
            }
            // Si Meteor falla o no está, usa MyNearWallet
            webWallet.requestSignIn(CONFIG.engineAccount, "Aurora Bridge");
        } else {
            if (nearWallet && nearWallet.signOut) nearWallet.signOut();
            nearAccountId = null;
            updateUI();
        }
    } catch (e) {
        showMessage("Error al conectar NEAR: " + e.message, true);
    }
}

// ==========================================
// 2. CONEXIÓN BILLETERA EVM (MetaMask / Mises)
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
                showMessage("⚠️ Por favor cambia a tu Virtual Chain en MetaMask", true);
            } else {
                showMessage("MetaMask conectado", false);
            }
            updateUI();
        } catch (error) {
            // Mostrará el error exacto (ej. User rejected request)
            showMessage("Error EVM: " + (error.message || "Rechazado por el usuario"), true);
            console.error(error);
        }
    } else {
        showMessage("No se detectó MetaMask en el navegador", true);
    }
}

// ==========================================
// 3. ACTUALIZACIÓN DE UI Y LECTURA DE SALDOS
// ==========================================
async function updateUI() {
    document.getElementById("near-account").innerText = nearAccountId || "No conectado";
    document.getElementById("btn-near").innerText = nearAccountId ? "Desconectar NEAR" : "Conectar NEAR";
    
    document.getElementById("evm-account").innerText = evmAddress || "No conectado";
    document.getElementById("btn-evm").innerText = evmAddress ? "Desconectar EVM" : "Conectar MetaMask";

    await updateBalances();
}

async function updateBalances() {
    const selectedAsset = document.getElementById("asset-select").value;
    const token = CONFIG.tokens[selectedAsset];

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

        if (nearWallet.signAndSendTransaction && nearWallet.isMeteor) {
            await nearWallet.signAndSendTransaction(tx);
            showMessage("¡Depósito exitoso!");
            setTimeout(updateBalances, 3000);
        } else {
            await webWallet.account().signAndSendTransaction(tx);
        }
    } catch (e) {
        showMessage("Error en el depósito. Revisa tu saldo.", true);
        console.error(e);
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

        // CORRECCIÓN: gasLimit manual forzado para saltarse el error de estimación en redes de gas gratuito
        const tx = await contract.withdraw(nearAccountId, amountWei, {
            gasLimit: 300000
        });
        
        showMessage("Procesando retiro en Virtual Chain...");
        await tx.wait();
        
        showMessage("¡Retiro exitoso!");
        setTimeout(updateBalances, 3000);
    } catch (e) {
        showMessage("Error de retiro: " + (e.reason || e.message || "Fallo desconocido"), true);
        console.error(e);
    }
}

function showMessage(msg, isError = false) {
    const el = document.getElementById("bridge-msg");
    el.innerText = msg;
    el.style.color = isError ? "#ef4444" : "#4ade80";
            }
