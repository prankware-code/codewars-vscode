import * as vscode from 'vscode';

const USERNAME_KEY = 'codewars.username';
const PROFILE_CACHE_KEY = 'codewars.profileCache';
const COMPLETED_CACHE_KEY = 'codewars.completedCache';
const TRAINER_PREFS_KEY = 'codewars.trainerPrefs';
const RECENT_KATAS_KEY = 'codewars.recentKatas';
const SESSION_COOKIE_SECRET = 'codewars.sessionCookie';

const USER_AGENT = 'Mozilla/5.0 codewars-vscode';

let welcomePanel: vscode.WebviewPanel | undefined = undefined;
let profilePanel: vscode.WebviewPanel | undefined = undefined;
let trainerPanel: vscode.WebviewPanel | undefined = undefined;
const kataPanels = new Map<string, vscode.WebviewPanel>();

interface TrainSession {
    kataId: string;
    projectId: string;
    solutionId?: string;
    language: string;
    testFramework?: string;
    languageVersion?: string;
    ciphered?: string[];
    successMode?: string | null;
    setupCode?: string;
    fullFixture?: string;
    jwt?: string;
    codeUri?: vscode.Uri;
    fixtureUri?: vscode.Uri;
}
const trainSessions = new Map<string, TrainSession>();
let codewarsOutput: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
    if (!codewarsOutput) {
        codewarsOutput = vscode.window.createOutputChannel('Codewars');
    }
    return codewarsOutput;
}

const TRAINING_MODES = [
    { id: 'fundamentals', title: 'Fundamentals', desc: 'Practice katas with a focus on core concepts.' },
    { id: 'rank-up', title: 'Rank Up', desc: 'Katas above your current rank to level up.' },
    { id: 'random', title: 'Random', desc: 'Pick a completely random kata across all languages.' },
    { id: 'practice', title: 'Practice', desc: 'Revisit katas you have already solved.' },
    { id: 'beta', title: 'Beta', desc: 'Try unpublished katas and help authors improve them.' },
    { id: 'kumite', title: 'Kumite', desc: 'Short challenges focused on refactoring and code golf.' }
];

const POPULAR_LANGUAGES = [
    'javascript', 'python', 'typescript', 'ruby', 'java', 'csharp', 'cpp', 'c',
    'go', 'rust', 'kotlin', 'swift', 'php', 'scala', 'haskell', 'elixir', 'clojure',
    'coffeescript', 'dart', 'fsharp', 'lua', 'ocaml', 'perl', 'r', 'sql'
];

const LANGUAGE_MAP: Record<string, string> = {
    javascript: 'javascript',
    typescript: 'typescript',
    coffeescript: 'coffeescript',
    python: 'python',
    ruby: 'ruby',
    java: 'java',
    kotlin: 'kotlin',
    scala: 'scala',
    groovy: 'groovy',
    cpp: 'cpp',
    c: 'c',
    csharp: 'csharp',
    fsharp: 'fsharp',
    go: 'go',
    rust: 'rust',
    swift: 'swift',
    php: 'php',
    haskell: 'haskell',
    clojure: 'clojure',
    elixir: 'elixir',
    erlang: 'erlang',
    lua: 'lua',
    perl: 'perl',
    r: 'r',
    sql: 'sql',
    dart: 'dart',
    ocaml: 'ocaml',
    nim: 'nim',
    crystal: 'crystal',
    elm: 'elm',
    shell: 'shellscript',
    bash: 'shellscript'
};

interface Rank {
    rank: number;
    name: string;
    color: string;
    score: number;
}

interface CodewarsUser {
    username: string;
    name: string | null;
    honor: number;
    clan: string | null;
    leaderboardPosition: number | null;
    skills: string[] | null;
    ranks: {
        overall: Rank;
        languages: Record<string, Rank>;
    };
    codeChallenges: {
        totalAuthored: number;
        totalCompleted: number;
    };
}

interface CompletedKata {
    id: string;
    name: string;
    slug: string;
    completedAt: string;
    completedLanguages: string[];
}

interface CompletedPage {
    totalPages: number;
    totalItems: number;
    data: CompletedKata[];
}

interface KataRank {
    id: number | null;
    name: string | null;
    color: string | null;
}

interface Kata {
    id: string;
    name: string;
    slug: string;
    url: string;
    category: string;
    description: string;
    tags: string[];
    languages: string[];
    rank: KataRank;
    createdBy: { username: string; url: string };
    publishedAt: string;
    approvedBy: { username: string; url: string } | null;
    totalAttempts: number;
    totalCompleted: number;
    totalStars: number;
    voteScore: number;
}

interface TrainerPrefs {
    mode: string;
    language: string;
}

interface RecentKata {
    id: string;
    name: string;
    slug: string;
    rank: string | null;
    color: string | null;
    viewedAt: string;
}

function extractSetupFromHtml(html: string): string | null {
    const scriptMatch = html.match(/<script[^>]*id="(?:session-data|kata-data|json-data)"[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
        try {
            const data = JSON.parse(scriptMatch[1].trim());
            if (typeof data.setup === 'string') {
                return data.setup;
            }
            if (data.session && typeof data.session.setup === 'string') {
                return data.session.setup;
            }
        } catch {}
    }

    const sessionMatch = html.match(/window\.App\.data\.session\s*=\s*(\{[\s\S]+?\});/);
    if (sessionMatch) {
        try {
            const session = JSON.parse(sessionMatch[1]);
            if (typeof session.setup === 'string') {
                return session.setup;
            }
        } catch {}
    }

    const setupMatch = html.match(/"setup"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (setupMatch) {
        try {
            const unescaped = JSON.parse(`"${setupMatch[1]}"`);
            if (typeof unescaped === 'string' && unescaped.length > 0) {
                return unescaped;
            }
        } catch {}
    }

    const textareaMatch = html.match(/<textarea[^>]*(?:id|name)="(?:code|setup|editor|solution|initial_code)"[^>]*>([\s\S]*?)<\/textarea>/i);
    if (textareaMatch) {
        const decoded = textareaMatch[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
        if (decoded.trim().length > 0) {
            return decoded;
        }
    }

    return null;
}

interface KataSessionResult {
    setup: string | null;
    exampleFixture?: string;
    fullFixture?: string;
    projectId?: string;
    solutionId?: string;
    testFramework?: string;
    languageVersion?: string;
    ciphered?: string[];
    successMode?: string | null;
    jwt?: string;
    rawSession?: unknown;
    debugHtml?: string;
}

async function fetchKataSetup(
    context: vscode.ExtensionContext,
    idOrSlug: string,
    language: string
): Promise<KataSessionResult> {
    const trainUrl = `https://www.codewars.com/kata/${encodeURIComponent(idOrSlug)}/train/${encodeURIComponent(language)}`;

    const pageResp = await fetchAuthed(context, trainUrl);
    if (!pageResp || !pageResp.ok) {
        return { setup: null };
    }
    const pageHtml = await pageResp.text();

    const projectMatch = pageHtml.match(/"session":"\\?\/kata\\?\/projects\\?\/([a-f0-9]+)/);
    const csrfMatch = pageHtml.match(/<meta name="csrf-token" content="([^"]+)"/);
    const cookie = await context.secrets.get(SESSION_COOKIE_SECRET);

    if (!projectMatch || !csrfMatch || !cookie) {
        const inlineSetup = extractSetupFromHtml(pageHtml);
        return inlineSetup
            ? { setup: inlineSetup }
            : { setup: null, debugHtml: pageHtml };
    }

    const projectId = projectMatch[1];
    const csrfToken = csrfMatch[1];
    const sessionUrl = `https://www.codewars.com/kata/projects/${projectId}/${encodeURIComponent(language)}/session`;

    try {
        const resp = await fetch(sessionUrl, {
            method: 'POST',
            headers: {
                'Cookie': `_session_id=${cookie}`,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'Referer': trainUrl
            },
            body: '{}',
            redirect: 'follow'
        });
        if (!resp.ok) {
            const body = await resp.text();
            return { setup: null, debugHtml: `POST ${sessionUrl} → ${resp.status}\n\n${body}` };
        }
        const contentType = resp.headers.get('content-type') ?? '';
        if (!contentType.includes('json')) {
            const text = await resp.text();
            return { setup: null, debugHtml: text };
        }
        const data = await resp.json() as Record<string, unknown>;
        const jwtMatch = pageHtml.match(/\\"jwt\\":\\"([^"\\]+)\\"/);
        return {
            setup: (data.setup as string | undefined) ?? null,
            exampleFixture: (data.exampleFixture as string | undefined),
            fullFixture: (data.fixture as string | undefined),
            projectId,
            solutionId: (data.relayId ?? data.id ?? data.solutionId ?? data.solution_id) as string | undefined,
            testFramework: data.testFramework as string | undefined,
            languageVersion: (data.languageVersion ?? data.activeVersion) as string | undefined,
            ciphered: (data.ciphered as string[] | undefined) ?? [],
            successMode: data.successMode as string | null | undefined,
            jwt: jwtMatch?.[1],
            rawSession: data
        };
    } catch (e) {
        return { setup: null, debugHtml: `fetch error: ${(e as Error).message}\n\n${pageHtml}` };
    }
}

async function fetchKata(idOrSlug: string): Promise<Kata> {
    const resp = await fetch(`https://www.codewars.com/api/v1/code-challenges/${encodeURIComponent(idOrSlug)}`);
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json() as Promise<Kata>;
}

function parseKataIdentifier(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }
    const urlMatch = trimmed.match(/codewars\.com\/kata\/([^/?#]+)/i);
    if (urlMatch) {
        return urlMatch[1];
    }
    return trimmed.replace(/^\/+|\/+$/g, '');
}

interface KataFilter {
    language: string;
    ranks?: number[];
    beta?: boolean;
    page?: number;
}

async function fetchAuthed(
    context: vscode.ExtensionContext,
    url: string,
    init?: RequestInit
): Promise<Response | null> {
    const cookie = await context.secrets.get(SESSION_COOKIE_SECRET);
    const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/json',
        ...(init?.headers as Record<string, string> ?? {})
    };
    if (cookie) {
        headers['Cookie'] = `_session_id=${cookie}`;
    }
    try {
        const resp = await fetch(url, { ...init, headers, redirect: 'follow' });
        if (cookie && (resp.url.includes('/users/sign_in') || resp.status === 401)) {
            await handleAuthFailure(context);
            return null;
        }
        return resp;
    } catch {
        return null;
    }
}

async function handleAuthFailure(context: vscode.ExtensionContext): Promise<void> {
    vscode.window.showWarningMessage('Codewars session expired — you have been signed out.');
    await vscode.commands.executeCommand('codewars.logout');
}

async function validateSessionCookie(username: string, cookie: string): Promise<boolean> {
    try {
        const resp = await fetch('https://www.codewars.com/users/edit', {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html',
                'Cookie': `_session_id=${cookie}`
            },
            redirect: 'follow'
        });
        if (!resp.ok || resp.url.includes('/users/sign_in')) {
            return false;
        }
        const html = await resp.text();
        return html.toLowerCase().includes(username.toLowerCase());
    } catch {
        return false;
    }
}

function modeToFilter(mode: string, language: string, userRank: number | null): KataFilter {
    const filter: KataFilter = { language, page: Math.floor(Math.random() * 4) };
    const rank = userRank ?? -8;
    const easier = (steps: number) => Math.max(rank - steps, -8);
    const harder = (steps: number) => Math.min(rank + steps, -1);
    switch (mode) {
        case 'fundamentals':
            filter.ranks = [easier(3), easier(2)];
            break;
        case 'rank-up':
            filter.ranks = [easier(1), rank, harder(1)];
            break;
        case 'beta':
            filter.beta = true;
            filter.ranks = [rank, harder(1)];
            break;
        case 'random':
        case 'kumite':
        default:
            break;
    }
    return filter;
}

async function pickRandomKataId(context: vscode.ExtensionContext, filter: KataFilter): Promise<string | null> {
    const reserved = new Set(['random', 'search', 'authored', 'beta', 'reviewing', 'new']);
    const params = new URLSearchParams();
    params.set('q', '');
    params.set('beta', filter.beta ? 'true' : 'false');
    for (const r of filter.ranks ?? []) {
        params.append('r[]', String(r));
    }
    params.set('order_by', 'satisfaction_percent desc');
    if (filter.page && filter.page > 0) {
        params.set('page', String(filter.page));
    }
    const url = filter.language
        ? `https://www.codewars.com/kata/search/${encodeURIComponent(filter.language)}?${params}`
        : `https://www.codewars.com/kata/search?${params}`;

    const resp = await fetchAuthed(context, url);
    if (!resp || !resp.ok) {
        return null;
    }
    const html = await resp.text();
    const slugs = new Set<string>();
    for (const m of html.matchAll(/href="\/kata\/([a-f0-9]{24}|[a-z][a-z0-9-]{4,})"/g)) {
        const s = m[1];
        if (!reserved.has(s) && !s.includes('/')) {
            slugs.add(s);
        }
    }
    const arr = Array.from(slugs);
    if (arr.length === 0) {
        return null;
    }
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickPracticeKataId(context: vscode.ExtensionContext): string | null {
    const completed = context.globalState.get<CompletedPage>(COMPLETED_CACHE_KEY);
    if (!completed || completed.data.length === 0) {
        return null;
    }
    return completed.data[Math.floor(Math.random() * completed.data.length)].id;
}

async function fetchUser(username: string): Promise<CodewarsUser> {
    const resp = await fetch(`https://www.codewars.com/api/v1/users/${encodeURIComponent(username)}`);
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json() as Promise<CodewarsUser>;
}

async function fetchCompleted(username: string, page = 0): Promise<CompletedPage> {
    const resp = await fetch(
        `https://www.codewars.com/api/v1/users/${encodeURIComponent(username)}/code-challenges/completed?page=${page}`
    );
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json() as Promise<CompletedPage>;
}

class ProfileProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh() { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: vscode.TreeItem) { return element; }

    getChildren(): vscode.TreeItem[] {
        const username = this.context.globalState.get<string>(USERNAME_KEY);
        if (!username) {
            const status = new vscode.TreeItem('Status: Not authorized');
            const login = new vscode.TreeItem('Login');
            login.iconPath = new vscode.ThemeIcon('sign-in');
            login.command = { command: 'codewars.openWelcome', title: 'Open Welcome' };
            return [status, login];
        }

        const user = this.context.globalState.get<CodewarsUser>(PROFILE_CACHE_KEY);

        const header = new vscode.TreeItem(`@${username}`);
        header.iconPath = new vscode.ThemeIcon('account');
        const items: vscode.TreeItem[] = [header];

        if (user) {
            const rank = new vscode.TreeItem(`Rank: ${user.ranks.overall.name}`);
            rank.iconPath = new vscode.ThemeIcon('star-full');
            const honor = new vscode.TreeItem(`Honor: ${user.honor.toLocaleString()}`);
            honor.iconPath = new vscode.ThemeIcon('heart');
            const completed = new vscode.TreeItem(`Completed: ${user.codeChallenges.totalCompleted}`);
            completed.iconPath = new vscode.ThemeIcon('check');
            items.push(rank, honor, completed);
            if (user.leaderboardPosition) {
                const lb = new vscode.TreeItem(`Leaderboard: #${user.leaderboardPosition.toLocaleString()}`);
                lb.iconPath = new vscode.ThemeIcon('list-ordered');
                items.push(lb);
            }
        }

        const viewProfile = new vscode.TreeItem('View profile');
        viewProfile.iconPath = new vscode.ThemeIcon('preview');
        viewProfile.command = { command: 'codewars.openProfile', title: 'Open profile' };
        const refresh = new vscode.TreeItem('Refresh');
        refresh.iconPath = new vscode.ThemeIcon('refresh');
        refresh.command = { command: 'codewars.refresh', title: 'Refresh' };
        const logout = new vscode.TreeItem('Logout');
        logout.iconPath = new vscode.ThemeIcon('sign-out');
        logout.command = { command: 'codewars.logout', title: 'Logout' };
        items.push(viewProfile, refresh, logout);
        return items;
    }
}

class KataListProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh() { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: vscode.TreeItem) { return element; }

    getChildren(): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];

        const start = new vscode.TreeItem('Start training...');
        start.iconPath = new vscode.ThemeIcon('play-circle');
        start.command = { command: 'codewars.openTrainer', title: 'Start training' };
        items.push(start);

        const open = new vscode.TreeItem('Open kata by URL or ID...');
        open.iconPath = new vscode.ThemeIcon('link');
        open.command = { command: 'codewars.openKataByUrl', title: 'Open kata' };
        items.push(open);

        const prefs = this.context.globalState.get<TrainerPrefs>(TRAINER_PREFS_KEY);
        for (const mode of TRAINING_MODES) {
            const item = new vscode.TreeItem(mode.title);
            item.iconPath = new vscode.ThemeIcon('rocket');
            item.tooltip = mode.desc;
            item.command = {
                command: 'codewars.startTraining',
                title: mode.title,
                arguments: [mode.id, prefs?.language ?? 'javascript']
            };
            items.push(item);
        }

        const recent = this.context.globalState.get<RecentKata[]>(RECENT_KATAS_KEY) ?? [];
        if (recent.length > 0) {
            const header = new vscode.TreeItem('Recent', vscode.TreeItemCollapsibleState.None);
            header.description = `(${recent.length})`;
            items.push(header);
            for (const kata of recent.slice(0, 10)) {
                const item = new vscode.TreeItem(kata.name);
                item.description = kata.rank ?? '';
                item.iconPath = new vscode.ThemeIcon('notebook');
                item.tooltip = `${kata.name}${kata.rank ? ' · ' + kata.rank : ''}`;
                item.command = {
                    command: 'codewars.openKataById',
                    title: 'Open kata',
                    arguments: [kata.id]
                };
                items.push(item);
            }
        }

        return items;
    }
}

async function rememberKata(context: vscode.ExtensionContext, kata: Kata) {
    const list = context.globalState.get<RecentKata[]>(RECENT_KATAS_KEY) ?? [];
    const filtered = list.filter(k => k.id !== kata.id);
    filtered.unshift({
        id: kata.id,
        name: kata.name,
        slug: kata.slug,
        rank: kata.rank.name,
        color: kata.rank.color,
        viewedAt: new Date().toISOString()
    });
    await context.globalState.update(RECENT_KATAS_KEY, filtered.slice(0, 20));
}

async function loadData(context: vscode.ExtensionContext, username: string): Promise<{ user: CodewarsUser; completed: CompletedPage } | null> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading @${username}...` },
        async () => {
            try {
                const [user, completed] = await Promise.all([
                    fetchUser(username),
                    fetchCompleted(username).catch(() => ({ totalPages: 0, totalItems: 0, data: [] } as CompletedPage))
                ]);
                await context.globalState.update(PROFILE_CACHE_KEY, user);
                await context.globalState.update(COMPLETED_CACHE_KEY, completed);
                return { user, completed };
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to load profile: ${(e as Error).message}`);
                return null;
            }
        }
    );
}

export function activate(context: vscode.ExtensionContext) {
    const profileProvider = new ProfileProvider(context);
    vscode.window.registerTreeDataProvider('codewars-profile', profileProvider);

    const kataListProvider = new KataListProvider(context);
    vscode.window.registerTreeDataProvider('codewars-kata-list', kataListProvider);

    const openWelcomeCmd = vscode.commands.registerCommand('codewars.openWelcome', () => {
        if (welcomePanel) {
            welcomePanel.reveal(vscode.ViewColumn.One);
            return;
        }
        welcomePanel = vscode.window.createWebviewPanel(
            'codewarsWelcome',
            'Welcome to Codewars',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        welcomePanel.webview.html = getWelcomeHtml();
        welcomePanel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'login') {
                vscode.commands.executeCommand('codewars.login');
            }
        });
        welcomePanel.onDidDispose(() => { welcomePanel = undefined; });
    });

    const loginCmd = vscode.commands.registerCommand('codewars.login', async () => {
        const username = await vscode.window.showInputBox({
            prompt: 'Codewars username',
            placeHolder: 'e.g. some-user',
            ignoreFocusOut: true,
            validateInput: v => v.trim() ? null : 'Username required'
        });
        if (!username) {
            return;
        }
        const trimmedUser = username.trim();

        const data = await loadData(context, trimmedUser);
        if (!data) {
            return;
        }

        const cookie = await vscode.window.showInputBox({
            prompt: 'Paste the _session_id cookie from codewars.com (DevTools → Application → Cookies). Leave empty to skip.',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'Optional — enables rank-filtered trainer and authed features'
        });

        if (cookie && cookie.trim()) {
            const valid = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Validating session cookie...' },
                () => validateSessionCookie(trimmedUser, cookie.trim())
            );
            if (!valid) {
                const choice = await vscode.window.showWarningMessage(
                    'Session cookie looks invalid — we landed on a sign-in page. Continue without it?',
                    'Continue', 'Cancel'
                );
                if (choice !== 'Continue') {
                    return;
                }
            } else {
                await context.secrets.store(SESSION_COOKIE_SECRET, cookie.trim());
            }
        }

        await context.globalState.update(USERNAME_KEY, trimmedUser);

        vscode.window.showInformationMessage(`Signed in as @${trimmedUser}`);
        profileProvider.refresh();
        kataListProvider.refresh();
        welcomePanel?.dispose();
        vscode.commands.executeCommand('codewars.openProfile');
    });

    const logoutCmd = vscode.commands.registerCommand('codewars.logout', async () => {
        await context.globalState.update(USERNAME_KEY, undefined);
        await context.globalState.update(PROFILE_CACHE_KEY, undefined);
        await context.globalState.update(COMPLETED_CACHE_KEY, undefined);
        await context.secrets.delete(SESSION_COOKIE_SECRET);
        profilePanel?.dispose();
        trainerPanel?.dispose();
        profileProvider.refresh();
        kataListProvider.refresh();
        vscode.window.showInformationMessage('Signed out of Codewars.');
    });

    const refreshCmd = vscode.commands.registerCommand('codewars.refresh', async () => {
        const username = context.globalState.get<string>(USERNAME_KEY);
        if (!username) {
            vscode.window.showWarningMessage('Not signed in.');
            return;
        }
        const data = await loadData(context, username);
        if (!data) {
            return;
        }
        profileProvider.refresh();
        if (profilePanel) {
            profilePanel.webview.html = getProfileHtml(data.user, data.completed);
        }
    });

    const openProfileCmd = vscode.commands.registerCommand('codewars.openProfile', () => {
        const username = context.globalState.get<string>(USERNAME_KEY);
        const user = context.globalState.get<CodewarsUser>(PROFILE_CACHE_KEY);
        const completed = context.globalState.get<CompletedPage>(COMPLETED_CACHE_KEY)
            ?? { totalPages: 0, totalItems: 0, data: [] };
        if (!username || !user) {
            vscode.window.showWarningMessage('Not signed in.');
            return;
        }
        if (profilePanel) {
            profilePanel.reveal(vscode.ViewColumn.One);
            return;
        }
        profilePanel = vscode.window.createWebviewPanel(
            'codewarsProfile',
            `Codewars: @${username}`,
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        profilePanel.webview.html = getProfileHtml(user, completed);
        profilePanel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'refresh') {
                vscode.commands.executeCommand('codewars.refresh');
            }
        });
        profilePanel.onDidDispose(() => { profilePanel = undefined; });
    });

    const openTrainerCmd = vscode.commands.registerCommand('codewars.openTrainer', () => {
        if (trainerPanel) {
            trainerPanel.reveal(vscode.ViewColumn.One);
            return;
        }
        trainerPanel = vscode.window.createWebviewPanel(
            'codewarsTrainer',
            'Codewars: Train',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        const prefs = context.globalState.get<TrainerPrefs>(TRAINER_PREFS_KEY)
            ?? { mode: 'fundamentals', language: 'javascript' };
        const user = context.globalState.get<CodewarsUser>(PROFILE_CACHE_KEY);
        const userLanguages = user ? Object.keys(user.ranks.languages) : [];
        trainerPanel.webview.html = getTrainerHtml(prefs, userLanguages);
        trainerPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'start') {
                vscode.commands.executeCommand('codewars.startTraining', message.mode, message.language);
            } else if (message.command === 'openKataByUrl') {
                vscode.commands.executeCommand('codewars.openKataByUrl');
            }
        });
        trainerPanel.onDidDispose(() => { trainerPanel = undefined; });
    });

    const startTrainingCmd = vscode.commands.registerCommand(
        'codewars.startTraining',
        async (mode: string, language: string) => {
            await context.globalState.update(TRAINER_PREFS_KEY, { mode, language });
            kataListProvider.refresh();

            const id = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Picking a ${mode} kata...` },
                async () => {
                    if (mode === 'practice') {
                        const username = context.globalState.get<string>(USERNAME_KEY);
                        if (!username) {
                            vscode.window.showWarningMessage('Sign in first to use Practice mode.');
                            return null;
                        }
                        const picked = pickPracticeKataId(context);
                        if (!picked) {
                            vscode.window.showWarningMessage('No completed katas cached. Try Refresh in the profile view.');
                        }
                        return picked;
                    }
                    const user = context.globalState.get<CodewarsUser>(PROFILE_CACHE_KEY);
                    const userRank = user?.ranks.overall.rank ?? null;
                    return pickRandomKataId(context, modeToFilter(mode, language, userRank));
                }
            );
            if (!id) {
                return;
            }
            vscode.commands.executeCommand('codewars.openKataById', id);
        }
    );

    const openKataByUrlCmd = vscode.commands.registerCommand('codewars.openKataByUrl', async () => {
        const input = await vscode.window.showInputBox({
            prompt: 'Codewars kata URL, slug or ID',
            placeHolder: 'https://www.codewars.com/kata/... or slug-or-id',
            ignoreFocusOut: true,
            validateInput: v => parseKataIdentifier(v) ? null : 'Provide a kata URL, slug or ID'
        });
        if (!input) {
            return;
        }
        const id = parseKataIdentifier(input);
        if (!id) {
            return;
        }
        vscode.commands.executeCommand('codewars.openKataById', id);
    });

    const openKataByIdCmd = vscode.commands.registerCommand('codewars.openKataById', async (idOrSlug: string) => {
        if (!idOrSlug) {
            return;
        }
        const kata = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Loading kata ${idOrSlug}...` },
            async () => {
                try {
                    return await fetchKata(idOrSlug);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to load kata: ${(e as Error).message}`);
                    return null;
                }
            }
        );
        if (!kata) {
            return;
        }
        await rememberKata(context, kata);
        kataListProvider.refresh();

        const existing = kataPanels.get(kata.id);
        if (existing) {
            existing.reveal(vscode.ViewColumn.One);
            existing.webview.html = getKataHtml(kata);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'codewarsKata',
            `Kata: ${kata.name}`,
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        panel.webview.html = getKataHtml(kata);
        panel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'openExternal' && message.url) {
                vscode.env.openExternal(vscode.Uri.parse(message.url));
            } else if (message.command === 'skip') {
                const prefs = context.globalState.get<TrainerPrefs>(TRAINER_PREFS_KEY)
                    ?? { mode: 'random', language: 'javascript' };
                panel.dispose();
                vscode.commands.executeCommand('codewars.startTraining', prefs.mode, prefs.language);
            } else if (message.command === 'train') {
                vscode.commands.executeCommand('codewars.trainKata', kata.id);
            } else if (message.command === 'test') {
                vscode.commands.executeCommand('codewars.testKata', kata.id);
            } else if (message.command === 'attempt') {
                vscode.commands.executeCommand('codewars.attemptKata', kata.id);
            }
        });
        panel.onDidDispose(() => { kataPanels.delete(kata.id); });
        kataPanels.set(kata.id, panel);
    });

    const trainKataCmd = vscode.commands.registerCommand('codewars.trainKata', async (idOrSlug: string) => {
        if (!idOrSlug) {
            return;
        }
        let kata: Kata;
        try {
            kata = await fetchKata(idOrSlug);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to load kata: ${(e as Error).message}`);
            return;
        }

        const prefs = context.globalState.get<TrainerPrefs>(TRAINER_PREFS_KEY);
        let language = prefs?.language && kata.languages.includes(prefs.language) ? prefs.language : undefined;
        if (!language) {
            language = await vscode.window.showQuickPick(kata.languages, {
                title: `Train "${kata.name}"`,
                placeHolder: 'Choose language'
            });
        }
        if (!language) {
            return;
        }

        const hasCookie = Boolean(await context.secrets.get(SESSION_COOKIE_SECRET));
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Loading ${language} starter...` },
            () => fetchKataSetup(context, idOrSlug, language!)
        );

        if (!result.setup && result.debugHtml) {
            const choice = await vscode.window.showWarningMessage(
                'Starter code not found. Open raw HTML to inspect what Codewars returned?',
                'Open HTML', 'Dismiss'
            );
            if (choice === 'Open HTML') {
                const doc = await vscode.workspace.openTextDocument({
                    content: result.debugHtml,
                    language: 'html'
                });
                await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            }
        } else if (!result.setup) {
            vscode.window.showWarningMessage(
                hasCookie
                    ? 'Starter code not found on the train page — opening an empty file.'
                    : 'Starter code requires a session cookie. Sign in with _session_id to fetch it.'
            );
        }

        let panel = kataPanels.get(kata.id);
        if (!panel) {
            await vscode.commands.executeCommand('codewars.openKataById', kata.id);
            panel = kataPanels.get(kata.id);
        }
        panel?.reveal(vscode.ViewColumn.One, false);

        const vscodeLang = LANGUAGE_MAP[language] ?? 'plaintext';
        const doc = await vscode.workspace.openTextDocument({
            content: result.setup ?? `// Starter code unavailable for ${kata.name} (${language}).\n`,
            language: vscodeLang
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);

        const session: TrainSession = {
            kataId: kata.id,
            projectId: result.projectId ?? '',
            solutionId: result.solutionId,
            language,
            testFramework: result.testFramework,
            languageVersion: result.languageVersion,
            ciphered: result.ciphered,
            successMode: result.successMode,
            setupCode: result.setup ?? undefined,
            fullFixture: result.fullFixture,
            jwt: result.jwt,
            codeUri: doc.uri
        };

        const out = getOutputChannel();
        out.appendLine(`\n─── Session for ${kata.name} (${language}) ───`);
        out.appendLine(`projectId: ${session.projectId}`);
        out.appendLine(`solutionId: ${session.solutionId ?? '(missing)'}`);
        out.appendLine(`testFramework: ${session.testFramework ?? '(missing)'}`);
        out.appendLine(`jwt: ${session.jwt ? session.jwt.slice(0, 20) + '...' : '(missing)'}`);
        if (result.rawSession) {
            out.appendLine(`Raw session keys: ${Object.keys(result.rawSession as object).join(', ')}`);
        }

        if (result.exampleFixture && result.exampleFixture.trim().length > 0) {
            const testsDoc = await vscode.workspace.openTextDocument({
                content: result.exampleFixture,
                language: vscodeLang
            });
            await vscode.commands.executeCommand('workbench.action.newGroupBelow');
            await vscode.window.showTextDocument(testsDoc, { preview: false });
            session.fixtureUri = testsDoc.uri;
        }

        trainSessions.set(kata.id, session);
        if (panel) {
            panel.webview.html = getKataHtml(kata, true);
        }
    });

    const testKataCmd = vscode.commands.registerCommand('codewars.testKata', async (kataId: string) => {
        await runKata(kataId, 'test');
    });

    async function runKata(kataId: string, mode: 'test' | 'attempt'): Promise<void> {
        const session = trainSessions.get(kataId);
        if (!session) {
            vscode.window.showWarningMessage('Click "Train this kata" first.');
            return;
        }

        const findDocByUri = (uri: vscode.Uri | undefined) => uri
            ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
            : undefined;
        const findVisibleByColumn = (col: vscode.ViewColumn) =>
            vscode.window.visibleTextEditors.find(e => e.viewColumn === col)?.document;

        let codeDoc = findDocByUri(session.codeUri) ?? findVisibleByColumn(vscode.ViewColumn.Two);
        let fixtureDoc = findDocByUri(session.fixtureUri) ?? findVisibleByColumn(vscode.ViewColumn.Three);
        if (codeDoc) {
            session.codeUri = codeDoc.uri;
        }
        if (fixtureDoc) {
            session.fixtureUri = fixtureDoc.uri;
        }
        const code = codeDoc?.getText() ?? '';
        const fixture = fixtureDoc?.getText() ?? '';
        if (!code.trim()) {
            vscode.window.showWarningMessage('Code editor is empty — nothing to run.');
            return;
        }

        const out = getOutputChannel();
        out.show(true);
        out.appendLine(`\n─── ${new Date().toLocaleTimeString()} · ${mode.toUpperCase()} · ${session.language} ───`);

        const cookie = await context.secrets.get(SESSION_COOKIE_SECRET);
        if (!cookie) {
            out.appendLine('No session cookie. Sign in first.');
            return;
        }

        out.appendLine('→ Refreshing session (new relayId)...');
        const fresh = await fetchKataSetup(context, kataId, session.language);
        if (!fresh.solutionId || !fresh.jwt) {
            out.appendLine('Failed to refresh session — cannot get relayId/jwt.');
            if (fresh.debugHtml) {
                out.appendLine(fresh.debugHtml.slice(0, 400));
            }
            return;
        }
        session.solutionId = fresh.solutionId;
        session.jwt = fresh.jwt;
        session.testFramework = fresh.testFramework ?? session.testFramework;
        session.languageVersion = fresh.languageVersion ?? session.languageVersion;
        session.ciphered = fresh.ciphered ?? session.ciphered;
        session.successMode = fresh.successMode ?? session.successMode;
        session.setupCode = fresh.setup ?? session.setupCode;
        session.fullFixture = fresh.fullFixture ?? session.fullFixture;

        const pageResp = await fetchAuthed(
            context,
            `https://www.codewars.com/kata/${encodeURIComponent(kataId)}/train/${encodeURIComponent(session.language)}`
        );
        const pageHtml = pageResp ? await pageResp.text() : '';
        const csrfMatch = pageHtml.match(/<meta name="csrf-token" content="([^"]+)"/);
        const csrfToken = csrfMatch?.[1];

        out.appendLine('→ POST https://www.codewars.com/api/v1/runner/authorize');
        let runnerJwt: string | null = null;
        try {
            const authResp = await fetch('https://www.codewars.com/api/v1/runner/authorize', {
                method: 'POST',
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json, text/plain, */*',
                    'X-Requested-With': 'XMLHttpRequest',
                    'authorization': session.jwt,
                    'X-CSRF-Token': csrfToken ?? '',
                    'Cookie': `_session_id=${cookie}`,
                    'Origin': 'https://www.codewars.com',
                    'Referer': `https://www.codewars.com/kata/${kataId}/train/${session.language}`
                }
            });
            const authBody = await authResp.text();
            out.appendLine(`← HTTP ${authResp.status} · ${authResp.headers.get('content-type') ?? '(no content-type)'}`);
            if (!authResp.ok) {
                out.appendLine(authBody.slice(0, 400));
                return;
            }
            try {
                const parsed = JSON.parse(authBody);
                runnerJwt = parsed.token ?? parsed.jwt ?? parsed.access_token ?? null;
            } catch {
                runnerJwt = authBody.trim().replace(/^"|"$/g, '');
            }
            if (!runnerJwt) {
                out.appendLine(`authorize response (first 400): ${authBody.slice(0, 400)}`);
                return;
            }
        } catch (e) {
            out.appendLine(`Error calling /authorize: ${(e as Error).message}`);
            return;
        }

        const channelId = `runner:${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 14)}`;
        const isAttempt = mode === 'attempt';
        if (isAttempt && !session.fullFixture) {
            out.appendLine('No encrypted fixture in session — cannot submit. Reopen via Train.');
            return;
        }
        const payload = {
            code,
            fixture: isAttempt ? session.fullFixture! : fixture,
            setup: '',
            language: session.language,
            testFramework: session.testFramework,
            languageVersion: session.languageVersion,
            relayId: session.solutionId,
            ciphered: isAttempt ? ['setup', 'fixture'] : [],
            channel: channelId,
            successMode: session.successMode ?? null
        };

        out.appendLine(`Payload: relayId=${payload.relayId} lang=${payload.language} version=${payload.languageVersion} framework=${payload.testFramework} ciphered=${JSON.stringify(payload.ciphered)} setup.len=${payload.setup.length} successMode=${payload.successMode}`);
        out.appendLine('→ POST https://runner.codewars.com/run');
        try {
            const resp = await fetch('https://runner.codewars.com/run', {
                method: 'POST',
                headers: {
                    'User-Agent': USER_AGENT,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/plain, */*',
                    'Authorization': `Bearer ${runnerJwt}`,
                    'Origin': 'https://cr.codewars.com',
                    'Referer': 'https://cr.codewars.com/'
                },
                body: JSON.stringify(payload)
            });
            const raw = await resp.text();
            out.appendLine(`← HTTP ${resp.status} · ${resp.headers.get('content-type') ?? '(no content-type)'}`);
            if (!resp.ok) {
                out.appendLine(raw.slice(0, 400));
                return;
            }
            let data: any;
            try {
                data = JSON.parse(raw);
            } catch {
                out.appendLine(`Non-JSON body (first 500 chars):\n${raw.slice(0, 500)}`);
                return;
            }
            formatRunResult(out, data);

            if (isAttempt && data.token) {
                out.appendLine(`\n→ POST /api/v1/code-challenges/projects/${session.projectId}/solutions/${session.solutionId}/notify`);
                try {
                    const notifyResp = await fetch(
                        `https://www.codewars.com/api/v1/code-challenges/projects/${session.projectId}/solutions/${session.solutionId}/notify`,
                        {
                            method: 'POST',
                            headers: {
                                'User-Agent': USER_AGENT,
                                'Content-Type': 'application/json',
                                'Accept': 'application/json, text/plain, */*',
                                'X-Requested-With': 'XMLHttpRequest',
                                'authorization': session.jwt!,
                                'X-CSRF-Token': csrfToken ?? '',
                                'Cookie': `_session_id=${cookie}`,
                                'Origin': 'https://www.codewars.com',
                                'Referer': `https://www.codewars.com/kata/${kataId}/train/${session.language}`
                            },
                            body: JSON.stringify({
                                token: data.token,
                                testFramework: session.testFramework,
                                code,
                                fixture: session.fullFixture,
                                languageVersion: session.languageVersion
                            })
                        }
                    );
                    const notifyBody = await notifyResp.text();
                    out.appendLine(`← HTTP ${notifyResp.status} · ${notifyBody.slice(0, 200)}`);
                    const completed = data.result?.completed === true;
                    if (completed) {
                        out.appendLine('\n✓ Kata completed — submission finalized on codewars.com');
                    } else {
                        out.appendLine('\nSome tests failed — nothing finalized.');
                    }
                } catch (e) {
                    out.appendLine(`Error calling /notify: ${(e as Error).message}`);
                }
            }
        } catch (e) {
            out.appendLine(`Error calling /run: ${(e as Error).message}`);
        }
    }

    const attemptKataCmd = vscode.commands.registerCommand('codewars.attemptKata', async (kataId: string) => {
        await runKata(kataId, 'attempt');
    });

    context.subscriptions.push(
        openWelcomeCmd, loginCmd, logoutCmd, refreshCmd, openProfileCmd,
        openTrainerCmd, startTrainingCmd, openKataByUrlCmd, openKataByIdCmd, trainKataCmd,
        testKataCmd, attemptKataCmd
    );
}

function formatRunResult(out: vscode.OutputChannel, data: any): void {
    if (data.stderr) {
        out.appendLine(`stderr:\n${data.stderr}`);
    }
    if (data.stdout) {
        out.appendLine(`stdout:\n${data.stdout}`);
    }
    const result = data.result;
    if (result && Array.isArray(result.output)) {
        out.appendLine('');
        renderOutputTree(out, result.output, 0);
    }
    if (result) {
        const passed = result.passed ?? 0;
        const failed = result.failed ?? 0;
        const errors = result.errors ?? 0;
        out.appendLine(`\nPassed: ${passed} · Failed: ${failed} · Errors: ${errors}`);
    }
    if (typeof data.exitCode === 'number') {
        out.appendLine(`exitCode: ${data.exitCode}${typeof data.wallTime === 'number' ? ` · ${data.wallTime}ms` : ''}`);
    }
}

function renderOutputTree(out: vscode.OutputChannel, nodes: any[], depth: number): void {
    const indent = '  '.repeat(depth);
    for (const node of nodes) {
        switch (node.t) {
            case 'describe':
                out.appendLine(`${indent}▾ ${node.v}`);
                if (Array.isArray(node.items)) { renderOutputTree(out, node.items, depth + 1); }
                break;
            case 'it':
                out.appendLine(`${indent}• ${node.v}`);
                if (Array.isArray(node.items)) { renderOutputTree(out, node.items, depth + 1); }
                break;
            case 'passed':
                out.appendLine(`${indent}✓ ${node.v}`);
                break;
            case 'failed':
                out.appendLine(`${indent}✗ ${node.v}`);
                break;
            case 'error':
                out.appendLine(`${indent}! ${node.v}`);
                break;
            case 'log':
                out.appendLine(`${indent}  ${node.v}`);
                break;
            case 'completedin':
                out.appendLine(`${indent}  (${node.v}ms)`);
                break;
            default:
                if (node.v) { out.appendLine(`${indent}${node.t}: ${node.v}`); }
        }
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function rankColorCss(color: string): string {
    const map: Record<string, string> = {
        white: '#ffffff',
        yellow: '#ecb613',
        blue: '#3c7ebb',
        purple: '#866cc7',
        red: '#a52a2a'
    };
    return map[color] ?? '#888';
}

function getProfileHtml(user: CodewarsUser, completed: CompletedPage): string {
    const langs = Object.entries(user.ranks.languages)
        .sort(([, a], [, b]) => b.score - a.score);

    const skills = (user.skills ?? []).map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('') || '<em>—</em>';

    const overallColor = rankColorCss(user.ranks.overall.color);

    const langRows = langs.map(([lang, r]) => `
        <tr>
            <td>${escapeHtml(lang)}</td>
            <td><span class="rank-pill" style="background:${rankColorCss(r.color)}">${escapeHtml(r.name)}</span></td>
            <td class="num">${r.score.toLocaleString()}</td>
        </tr>
    `).join('');

    const kataRows = completed.data.map(k => `
        <tr>
            <td><a href="https://www.codewars.com/kata/${encodeURIComponent(k.slug)}">${escapeHtml(k.name)}</a></td>
            <td>${k.completedLanguages.map(l => `<span class="chip small">${escapeHtml(l)}</span>`).join('')}</td>
            <td class="num">${new Date(k.completedAt).toLocaleDateString()}</td>
        </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
<style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
    h1 { margin: 0 0 4px; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-widget-border); margin-bottom: 16px; }
    .tab { padding: 8px 16px; cursor: pointer; border: none; background: transparent; color: var(--vscode-foreground); border-bottom: 2px solid transparent; }
    .tab.active { border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
    .pane { display: none; }
    .pane.active { display: block; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card { padding: 14px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
    .card .label { color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; }
    .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
    .rank-pill { display: inline-block; padding: 2px 10px; border-radius: 12px; color: #000; font-weight: 600; font-size: 12px; }
    .rank-pill.dark { color: #fff; }
    .chip { display: inline-block; padding: 2px 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; font-size: 12px; margin: 2px; }
    .chip.small { font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-widget-border); }
    th { color: var(--vscode-descriptionForeground); font-weight: 500; font-size: 12px; text-transform: uppercase; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .toolbar { float: right; }
    button.refresh { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; border-radius: 2px; }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px 0; }
</style>
</head>
<body>
    <div class="toolbar"><button class="refresh" onclick="vscode.postMessage({command:'refresh'})">↻ Refresh</button></div>
    <h1>${escapeHtml(user.name || user.username)}</h1>
    <div class="sub">@${escapeHtml(user.username)}${user.clan ? ' · ' + escapeHtml(user.clan) : ''}</div>

    <div class="tabs">
        <button class="tab active" data-tab="overview">Overview</button>
        <button class="tab" data-tab="languages">Languages (${langs.length})</button>
        <button class="tab" data-tab="katas">Completed (${completed.data.length}${completed.totalItems > completed.data.length ? ` of ${completed.totalItems}` : ''})</button>
    </div>

    <div class="pane active" id="pane-overview">
        <div class="grid">
            <div class="card">
                <div class="label">Overall rank</div>
                <div class="value"><span class="rank-pill ${user.ranks.overall.color === 'blue' || user.ranks.overall.color === 'purple' || user.ranks.overall.color === 'red' ? 'dark' : ''}" style="background:${overallColor}">${escapeHtml(user.ranks.overall.name)}</span></div>
            </div>
            <div class="card">
                <div class="label">Honor</div>
                <div class="value">${user.honor.toLocaleString()}</div>
            </div>
            <div class="card">
                <div class="label">Leaderboard</div>
                <div class="value">${user.leaderboardPosition ? '#' + user.leaderboardPosition.toLocaleString() : '—'}</div>
            </div>
            <div class="card">
                <div class="label">Completed katas</div>
                <div class="value">${user.codeChallenges.totalCompleted}</div>
            </div>
            <div class="card">
                <div class="label">Authored</div>
                <div class="value">${user.codeChallenges.totalAuthored}</div>
            </div>
            <div class="card">
                <div class="label">Overall score</div>
                <div class="value">${user.ranks.overall.score.toLocaleString()}</div>
            </div>
        </div>
        <h3>Skills</h3>
        <div>${skills}</div>
    </div>

    <div class="pane" id="pane-languages">
        ${langs.length === 0
            ? '<div class="empty">No language ranks yet.</div>'
            : `<table><thead><tr><th>Language</th><th>Rank</th><th class="num">Score</th></tr></thead><tbody>${langRows}</tbody></table>`}
    </div>

    <div class="pane" id="pane-katas">
        ${completed.data.length === 0
            ? '<div class="empty">No completed katas yet.</div>'
            : `<table><thead><tr><th>Name</th><th>Languages</th><th class="num">Completed</th></tr></thead><tbody>${kataRows}</tbody></table>`}
    </div>

<script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('pane-' + btn.dataset.tab).classList.add('active');
        });
    });
</script>
</body>
</html>`;
}

function renderMarkdown(md: string): string {
    let src = md.replace(/\r\n/g, '\n');
    const fences: string[] = [];
    src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang: string, code: string) => {
        const safe = escapeHtml(code.replace(/\n+$/, ''));
        const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
        fences.push(`<pre${langAttr}><code>${safe}</code></pre>`);
        return `\u0000FENCE${fences.length - 1}\u0000`;
    });

    const lines = src.split('\n');
    const out: string[] = [];
    let paragraph: string[] = [];
    const flushParagraph = () => {
        if (paragraph.length === 0) {
            return;
        }
        const joined = paragraph.join(' ').trim();
        if (joined) {
            out.push(`<p>${inlineMd(joined)}</p>`);
        }
        paragraph = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            flushParagraph();
            continue;
        }
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            flushParagraph();
            const level = headerMatch[1].length;
            out.push(`<h${level}>${inlineMd(headerMatch[2])}</h${level}>`);
            continue;
        }
        const fenceToken = trimmed.match(/^\u0000FENCE(\d+)\u0000$/);
        if (fenceToken) {
            flushParagraph();
            out.push(fences[Number(fenceToken[1])]);
            continue;
        }
        paragraph.push(trimmed);
    }
    flushParagraph();

    return out.join('\n');
}

function inlineMd(s: string): string {
    let html = escapeHtml(s);
    html = html.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    html = html.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, text, url) => `<a href="${url}">${text}</a>`);
    html = html.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
    html = html.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, (_, pre, c) => `${pre}<em>${c}</em>`);
    return html;
}

function getTrainerHtml(prefs: TrainerPrefs, userLangs: string[]): string {
    const langs = Array.from(new Set([...userLangs, ...POPULAR_LANGUAGES])).sort();
    const modeCards = TRAINING_MODES.map(m => `
        <label class="mode ${prefs.mode === m.id ? 'selected' : ''}">
            <input type="radio" name="mode" value="${m.id}" ${prefs.mode === m.id ? 'checked' : ''}>
            <div class="mode-title">${escapeHtml(m.title)}</div>
            <div class="mode-desc">${escapeHtml(m.desc)}</div>
        </label>
    `).join('');

    const langOptions = langs.map(l =>
        `<option value="${escapeHtml(l)}" ${prefs.language === l ? 'selected' : ''}>${escapeHtml(l)}</option>`
    ).join('');

    return `<!DOCTYPE html>
<html>
<head>
<style>
    body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); max-width: 760px; }
    h1 { margin: 0 0 4px; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
    .modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 24px; }
    .mode { display: block; padding: 14px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; cursor: pointer; }
    .mode.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .mode input { display: none; }
    .mode-title { font-weight: 600; margin-bottom: 4px; }
    .mode-desc { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); padding: 6px 8px; border-radius: 2px; min-width: 180px; }
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 18px; cursor: pointer; border-radius: 2px; font-size: 13px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-widget-border); }
    .note { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 20px; }
</style>
</head>
<body>
    <h1>Train</h1>
    <div class="sub">Выбирай режим и язык — Codewars откроется в браузере и подберёт кату.</div>

    <div class="modes">${modeCards}</div>

    <div class="row">
        <label class="field">
            <span>Language</span>
            <select id="language">${langOptions}</select>
        </label>
    </div>

    <div class="actions">
        <button onclick="start()">Start Training</button>
        <button class="secondary" onclick="openByUrl()">Open kata by URL…</button>
    </div>

    <div class="note">Ката открывается прямо в VS Code. <strong>Practice</strong> выбирает случайную из твоих решённых (нужен логин). Остальные режимы без API-ключа Codewars не фильтруются по режиму/языку — используется <code>/kata/random</code>.</div>

<script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.mode').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.mode').forEach(m => m.classList.remove('selected'));
            el.classList.add('selected');
            el.querySelector('input').checked = true;
        });
    });
    function currentMode() {
        const checked = document.querySelector('input[name="mode"]:checked');
        return checked ? checked.value : 'fundamentals';
    }
    function start() {
        vscode.postMessage({ command: 'start', mode: currentMode(), language: document.getElementById('language').value });
    }
    function openByUrl() {
        vscode.postMessage({ command: 'openKataByUrl' });
    }
</script>
</body>
</html>`;
}

function getKataHtml(kata: Kata, hasSession = false): string {
    const rankColor = kata.rank.color ? rankColorCss(kata.rank.color) : '#888';
    const tags = kata.tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('') || '<em>—</em>';
    const langs = kata.languages.map(l => `<span class="chip">${escapeHtml(l)}</span>`).join('') || '<em>—</em>';
    const description = renderMarkdown(kata.description || '*No description.*');
    const rankName = kata.rank.name ?? 'Unranked';
    const isDarkRank = kata.rank.color === 'blue' || kata.rank.color === 'purple' || kata.rank.color === 'red';

    return `<!DOCTYPE html>
<html>
<head>
<style>
    body { font-family: var(--vscode-font-family); padding: 20px 32px; color: var(--vscode-foreground); max-width: 900px; line-height: 1.5; }
    h1 { margin: 0 0 6px; }
    .meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .toolbar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
    .rank-pill { display: inline-block; padding: 3px 12px; border-radius: 12px; background: ${rankColor}; color: ${isDarkRank ? '#fff' : '#000'}; font-weight: 600; font-size: 13px; }
    .chip { display: inline-block; padding: 2px 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; font-size: 12px; margin: 2px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; border-radius: 2px; }
    button.secondary { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border); }
    .section { margin: 16px 0; }
    .section h3 { margin: 0 0 6px; color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stats { display: flex; gap: 18px; flex-wrap: wrap; }
    .stats div { font-size: 13px; }
    .stats .num { font-weight: 600; }
    pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; overflow-x: auto; }
    code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    pre code { background: transparent; padding: 0; }
    a { color: var(--vscode-textLink-foreground); }
    hr { border: none; border-top: 1px solid var(--vscode-widget-border); margin: 24px 0; }
</style>
</head>
<body>
    <h1>${escapeHtml(kata.name)}</h1>
    <div class="meta">
        <span class="rank-pill">${escapeHtml(rankName)}</span>
        · by <a href="${escapeHtml(kata.createdBy.url)}" onclick="openUrl(event,'${escapeHtml(kata.createdBy.url)}')">${escapeHtml(kata.createdBy.username)}</a>
        · ${escapeHtml(kata.category)}
    </div>

    <div class="toolbar">
        <button onclick="trainKata()">${hasSession ? 'Reopen editors' : 'Train this kata'}</button>
        ${hasSession ? `
        <button onclick="testKata()" title="Run code against your sample tests via cr.codewars.com">▶ Test</button>
        <button class="secondary" onclick="attemptKata()" title="Submit full solution — opens codewars.com">⤴ Attempt</button>
        ` : ''}
        <button class="secondary" onclick="openUrl(event,'${escapeHtml(kata.url)}')">Open on codewars.com</button>
        <button class="secondary" onclick="skipKata()" title="Pick another kata with the same mode/language">↻ Skip</button>
    </div>

    <div class="section">
        <h3>Tags</h3>
        <div>${tags}</div>
    </div>
    <div class="section">
        <h3>Languages</h3>
        <div>${langs}</div>
    </div>
    <div class="section stats">
        <div><span class="num">${kata.totalCompleted.toLocaleString()}</span> <span>completed</span></div>
        <div><span class="num">${kata.totalAttempts.toLocaleString()}</span> <span>attempts</span></div>
        <div><span class="num">${kata.totalStars.toLocaleString()}</span> <span>stars</span></div>
        <div><span class="num">${kata.voteScore.toLocaleString()}</span> <span>score</span></div>
    </div>

    <hr>

    <div class="description">${description}</div>

<script>
    const vscode = acquireVsCodeApi();
    function openUrl(e, url) {
        if (e) e.preventDefault();
        vscode.postMessage({ command: 'openExternal', url });
    }
    function skipKata() {
        vscode.postMessage({ command: 'skip' });
    }
    function trainKata() {
        vscode.postMessage({ command: 'train' });
    }
    function testKata() {
        vscode.postMessage({ command: 'test' });
    }
    function attemptKata() {
        vscode.postMessage({ command: 'attempt' });
    }
    document.querySelectorAll('.description a').forEach(a => {
        a.addEventListener('click', (e) => openUrl(e, a.getAttribute('href')));
    });
</script>
</body>
</html>`;
}

function getWelcomeHtml() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <style>
                body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
                .card { text-align: center; max-width: 400px; padding: 20px; border: 1px solid var(--vscode-widget-border); }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 10px 20px; cursor: pointer; border-radius: 2px; }
                button:hover { background: var(--vscode-button-hoverBackground); }
                a { color: var(--vscode-textLink-foreground); }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Codewars for VS Code</h1>
                <p>Тренируйте алгоритмы не выходя из редактора. Укажите свой username, чтобы подтянуть профиль и статистику.</p>
                <p style="font-size:12px;color:var(--vscode-descriptionForeground);line-height:1.5">
                    Опционально: вставь <code>_session_id</code> cookie с codewars.com<br>
                    (DevTools → Application → Cookies → <code>_session_id</code>) — тогда Rank Up будет подбирать каты на нужном уровне.
                </p>
                <button onclick="login()">Войти</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function login() {
                    vscode.postMessage({ command: 'login' });
                }
            </script>
        </body>
        </html>
    `;
}
