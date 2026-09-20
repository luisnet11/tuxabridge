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
            nearContract: "wrap.near", // Usado internamente para el puente
            evmContract: "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
            decimals: 24,
            isNative: true // Bandera especial para leer el saldo base
        },
        USDT: {
            nearContract: "usdt.tether-token.near",
            evmContract: "0x80da25da4d783e57d2fcda0436873a193a4beccf",
            decimals: 6,
            isNative: false
        }
    }
};

let webWallet = null;
let nearWallet = null;
let evmSigner = null;
let nearAccountId = null;
let evmAddress = null;

// ==========================================
// 1. CONEXIÓN BILLETERA NEAR
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

    if (webWallet.isSignedIn()) {
        nearWallet = webWallet;
        nearAccountId = webWallet.getAccountId();
    } else if (window.near && window.near.isMeteor && window.near.isSignedIn && window.near.isSignedIn()) {
        nearWallet = window.near;
        nearAccountId = window.near.getAccountId();
    }
    updateUI();
}

setTimeout(initNear, 500);

async function connectNear() {
    try {
        if (!nearAccountId) {
            if (window.near && window.near.isMeteor) {
                try {
                    const res = await window.near.requestSignIn({ contractId: CONFIG.engineAccount });
                    if (res) {
                        nearWallet = window.near;
                        nearAccountId = window.near.getAccountId();
                        updateUI();
                        return;
                    }
                } catch (e) {
                    console.log("Meteor falló, usando web...");
                }
            }
            webWallet.requestSignIn(CONFIG.engineAccount, "Aurora Bridge");
        } else {
            if (nearWallet && nearWallet.signOut) nearWallet.signOut();
            nearAccountId = null;
            updateUI();
        }
    } catch (e) {
        showMessage("Error NEAR: " + e.message, true);
    }
}

// ==========================================
// 2. CONEXIÓN BILLETERA EVM
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
                showMessage("⚠️ Cambia a tu Virtual Chain en MetaMask", true);
            } else {
                showMessage("MetaMask conectado", false);
            }
            updateUI();
        } catch (error) {
            showMessage("Error EVM: Rechazado", true);
        }
    } else {
        showMessage("No se detectó MetaMask", true);
    }
}

// ==========================================
// 3. LECTURA DE SALDOS CORRECTA (NATIVO Y NEP-141)
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

    // ------------------------------------
    // LECTURA EN NEAR (Diferencia Nativo vs Token)
    // ------------------------------------
    if (nearAccountId) {
        try {
            const provider = new window.nearApi.providers.JsonRpcProvider({ url: CONFIG.nearNodeUrl });
            
            if (token.isNative) {
                // Leer el saldo real de NEAR (Gas base)
                const res = await provider.query({
                    request_type: "view_account",
                    account_id: nearAccountId,
                    finality: "optimistic"
                });
                const balanceFormatted = ethers.formatUnits(res.amount, token.decimals);
                document.getElementById("near-balance").innerText = `Saldo: ${parseFloat(balanceFormatted).toFixed(4)} ${selectedAsset}`;
            } else {
                // Leer token NEP-141 (Ej: USDT)
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
            }
        } catch (e) {
            document.getElementById("near-balance").innerText = "Saldo: 0.00";
        }
    } else {
        document.getElementById("near-balance").innerText = "Saldo: 0.00";
    }

    // ------------------------------------
    // LECTURA EN EVM (Siempre ERC-20)
    // ------------------------------------
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

        let actions = [];
        
        // Si es NEAR Nativo, necesitamos empaquetarlo (wrap) y enviarlo en la misma transacción
        if (token.isNative) {
            actions = [
                {
                    type: "FunctionCall",
                    params: {
                        methodName: "near_deposit",
                        args: {},
                        gas: "30000000000000",
                        deposit: amountWei // Adjuntamos el NEAR real aquí
                    }
                },
                {
                    type: "FunctionCall",
                    params: {
                        methodName: "ft_transfer_call",
                        args: { receiver_id: CONFIG.engineAccount, amount: amountWei, msg: evmAddress },
                        gas: "60000000000000",
                        deposit: "1" // Solo 1 yocto para seguridad
                    }
                }
            ];
        } else {
            // Depósito normal de USDT
            actions = [{
                type: "FunctionCall",
                params: {
                    methodName: "ft_transfer_call",
                    args: { receiver_id: CONFIG.engineAccount, amount: amountWei, msg: evmAddress },
                    gas: "60000000000000",
                    deposit: "1"
                }
            }];
        }

        const tx = { receiverId: token.nearContract, actions: actions };

        if (nearWallet.signAndSendTransaction && nearWallet.isMeteor) {
            await nearWallet.signAndSendTransaction(tx);
            showMessage("¡Depósito exitoso!");
            setTimeout(updateBalances, 3000);
        } else {
            await webWallet.account().signAndSendTransaction(tx);
        }
    } catch (e) {
        showMessage("Error en depósito: Verifica tu saldo", true);
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

        // FORZAMOS GASPRICE: 0 para cadenas gratuitas de Aurora Cloud
        const tx = await contract.withdraw(nearAccountId, amountWei, {
            gasLimit: 3000000,
            gasPrice: 0 
        });
        
        showMessage("Procesando retiro en Virtual Chain...");
        await tx.wait();
        
        showMessage("¡Retiro exitoso!");
        setTimeout(updateBalances, 3000);
    } catch (e) {
        // Captura el error exacto y lo muestra en pantalla para poder diagnosticarlo si vuelve a fallar
        const errMsg = e.info?.error?.message || e.reason || e.message || "Fallo desconocido";
        showMessage("Error de retiro: " + errMsg, true);
        console.error("Detalle del error:", e);
    }
}

function showMessage(msg, isError = false) {
    const el = document.getElementById("bridge-msg");
    el.innerText = msg;
    el.style.color = isError ? "#ef4444" : "#4ade80";
}
