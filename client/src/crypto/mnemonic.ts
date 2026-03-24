/**
 * BIP39 Мнемоническая фраза для восстановления аккаунта
 * Генерирует 12-24 слова, из которых детерминированно создаются ключи
 */

import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { zeroBytes, type IdentityKeys } from './keys';

/**
 * Генерирует новую мнемоническую фразу (12 слов по умолчанию)
 */
export function generateMnemonic(strength: 128 | 256 = 128): string {
    // 128 бит = 12 слов, 256 бит = 24 слова
    return bip39.generateMnemonic(strength);
}

/**
 * Проверяет валидность мнемонической фразы
 */
export function validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic);
}

/**
 * Преобразует мнемоническую фразу в seed (512 бит)
 */
export async function mnemonicToSeed(mnemonic: string, passphrase: string = ''): Promise<Uint8Array> {
    const seedBuffer = await bip39.mnemonicToSeed(mnemonic, passphrase);
    return new Uint8Array(seedBuffer);
}

/**
 * Генерирует детерминированную пару ключей Ed25519 из seed
 */
function deriveSigningKeyPair(seed: Uint8Array): { publicKey: string; secretKey: string } {
    // Используем первые 32 байта seed для генерации ключей подписи
    const signingSeed = seed.slice(0, 32);
    try {
        const keyPair = nacl.sign.keyPair.fromSeed(signingSeed);

        return {
            publicKey: encodeBase64(keyPair.publicKey),
            secretKey: encodeBase64(keyPair.secretKey),
        };
    } finally {
        zeroBytes(signingSeed);
    }
}

/**
 * Генерирует детерминированную пару ключей X25519 из seed
 */
function deriveExchangeKeyPair(seed: Uint8Array): { publicKey: string; secretKey: string } {
    // Используем следующие 32 байта seed для ключей обмена
    const exchangeSeed = seed.slice(32, 64);
    const keyPair = nacl.box.keyPair.fromSecretKey(exchangeSeed);
    exchangeSeed.fill(0);

    return {
        publicKey: encodeBase64(keyPair.publicKey),
        secretKey: encodeBase64(keyPair.secretKey),
    };
}

/**
 * Восстанавливает ключи идентификации из мнемонической фразы
 */
export async function recoverIdentityFromMnemonic(
    mnemonic: string,
    passphrase: string = ''
): Promise<IdentityKeys> {
    if (!validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
    }

    const seed = await mnemonicToSeed(mnemonic, passphrase);

    const result = {
        signing: deriveSigningKeyPair(seed),
        exchange: deriveExchangeKeyPair(seed),
    };
    seed.fill(0);
    return result;
}

/**
 * Создает новый аккаунт с мнемонической фразой
 */
export async function createAccountWithMnemonic(
    strength: 128 | 256 = 128,
    passphrase: string = ''
): Promise<{
    mnemonic: string;
    identity: IdentityKeys;
}> {
    const mnemonic = generateMnemonic(strength);
    const identity = await recoverIdentityFromMnemonic(mnemonic, passphrase);

    return {
        mnemonic,
        identity,
    };
}

/**
 * Маскирует мнемоническую фразу для безопасного отображения
 * Показывает только первые и последние слова
 */
export function maskMnemonic(mnemonic: string): string {
    const words = mnemonic.split(' ');
    if (words.length <= 4) {
        return words.map(() => '****').join(' ');
    }

    return [
        words[0],
        '****',
        '****',
        '...',
        '****',
        words[words.length - 1],
    ].join(' ');
}

/**
 * Разбивает мнемоническую фразу на слова для проверки пользователем
 */
export function getMnemonicWords(mnemonic: string): string[] {
    return mnemonic.split(' ');
}

/**
 * Проверяет, что пользователь правильно ввел слова из мнемоники
 * Запрашивает случайные позиции слов
 */
export function getRandomWordPositions(wordCount: number, checkCount: number = 3): number[] {
    const positions: number[] = [];
    const available = Array.from({ length: wordCount }, (_, i) => i);

    for (let i = 0; i < Math.min(checkCount, wordCount); i++) {
        const randomBytes = new Uint32Array(1);
        crypto.getRandomValues(randomBytes);
        const randomIndex = randomBytes[0]! % available.length;
        positions.push(available[randomIndex]!);
        available.splice(randomIndex, 1);
    }

    return positions.sort((a, b) => a - b);
}

/**
 * Проверяет ответы пользователя на слова мнемоники
 */
export function verifyMnemonicWords(
    mnemonic: string,
    positions: number[],
    answers: string[]
): boolean {
    const words = getMnemonicWords(mnemonic);

    return positions.every((pos, index) => {
        const expected = words[pos]?.toLowerCase().trim();
        const actual = answers[index]?.toLowerCase().trim();
        return expected === actual;
    });
}
