'use strict';

/* =========================================================
 * 不可視生物生態研究室「大投稿祭」得点集計
 * ========================================================= */

const API_BASE = 'https://invisible-beasts.com/wp-json/wp/v2';
const POSTS_PER_PAGE = 100;
const EVENT_START = '2026-08-01';
const EVENT_END = '2026-08-31';

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbxQrFQZwoHjmlcYOEePELYZRg5Hq_B8j8fWi5QkYObq5nmzbkYv7sbIyxoh8QkAjw5gXQ/exec';

const TEAM_SETTINGS = {
  dimensional: {
    tagName: 'チーム異次元',
    categoryScores: {
      '異次元生物': 10,
      '完全透過性生物': 5,
      '超擬態生物': 5,
      '関連文書': 5,
      '無気配生物': 3
    }
  },
  presence: {
    tagName: 'チーム無気配',
    categoryScores: {
      '無気配生物': 10,
      '完全透過性生物': 5,
      '超擬態生物': 5,
      '関連文書': 5,
      '異次元生物': 3
    }
  }
};

/* 緊急ミッション */
const I = 100 * 0;
const P = 100 * 3;

/* X投稿 */
const X_POST_POINTS = {
  normal: 1,
  link: 3,
  fanmade: 10,
  fanmade_link: 13,
  declaration: 5
};

const SCORE_STATE = {
  report: {
    dimensional: 0,
    presence: 0,
    loaded: false,
    error: false
  },
  mission: {
    dimensional: I,
    presence: P
  },
  x: {
    dimensional: 0,
    presence: 0,
    loaded: false,
    error: false
  }
};

const X_FORM_STATE = {
  previewedPostId: '',
  previewedUrl: '',
  previewResult: null,
  submitting: false
};


/* =========================================================
 * DOM
 * ========================================================= */

function getScoreElement(team, index) {
  const selector =
    team === 'dimensional'
      ? '.score-dimensional'
      : '.score-presence';

  return document.querySelectorAll(selector)[index] || null;
}

function setText(element, text) {
  if (element) {
    element.textContent = text;
  }
}


/* =========================================================
 * WordPress REST API
 * ========================================================= */

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store'
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(`APIのJSONを解析できませんでした: ${url}`);
  }

  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : `HTTP ${response.status}`;

    throw new Error(`${message}: ${url}`);
  }

  return { data, response };
}

async function fetchAllPages(endpoint, params = {}) {
  const allItems = [];
  let page = 1;
  let totalPages = null;
  const MAX_PAGES = 100;

  while (page <= MAX_PAGES) {
    const url = new URL(`${API_BASE}/${endpoint}`);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    url.searchParams.set('per_page', String(POSTS_PER_PAGE));
    url.searchParams.set('page', String(page));

    const result = await fetchJson(url.toString());

    if (!Array.isArray(result.data)) {
      throw new Error(`${endpoint} の応答形式が不正です。`);
    }

    allItems.push(...result.data);

    if (totalPages === null) {
      const parsed = Number(
        result.response.headers.get('X-WP-TotalPages')
      );

      if (Number.isInteger(parsed) && parsed >= 1) {
        totalPages = parsed;
      }
    }

    if (totalPages !== null) {
      if (page >= totalPages) {
        return allItems;
      }
    } else if (result.data.length < POSTS_PER_PAGE) {
      return allItems;
    }

    page++;
  }

  throw new Error('APIのページ数が安全上限を超えました。');
}

async function getTagId(tagName) {
  const url = new URL(`${API_BASE}/tags`);

  url.searchParams.set('search', tagName);
  url.searchParams.set('per_page', '100');

  const result = await fetchJson(url.toString());

  const exactTag = Array.isArray(result.data)
    ? result.data.find(
        tag => String(tag.name || '').trim() === tagName
      )
    : null;

  if (!exactTag) {
    throw new Error(`タグ「${tagName}」が見つかりません。`);
  }

  return exactTag.id;
}

async function getCategoryMap() {
  const categories = await fetchAllPages('categories');
  const map = new Map();

  for (const category of categories) {
    map.set(
      category.id,
      String(category.name || '').trim()
    );
  }

  return map;
}

function isEventPost(post) {
  if (typeof post.date !== 'string' || post.date.length < 10) {
    return false;
  }

  const date = post.date.slice(0, 10);

  return date >= EVENT_START && date <= EVENT_END;
}

function calculatePostScore(post, categoryMap, categoryScores) {
  const ids = Array.isArray(post.categories)
    ? post.categories
    : [];

  const categoryNames = ids
    .map(id => categoryMap.get(id))
    .filter(Boolean);

  const scores = categoryNames
    .filter(name =>
      Object.prototype.hasOwnProperty.call(
        categoryScores,
        name
      )
    )
    .map(name => categoryScores[name]);

  return {
    score: scores.length > 0 ? Math.min(...scores) : 0,
    categoryNames
  };
}

async function calculateTeam(teamSetting, categoryMap) {
  const tagId = await getTagId(teamSetting.tagName);

  const posts = await fetchAllPages('posts', {
    tags: tagId,
    status: 'publish',
    _fields: 'id,date,link,title,categories'
  });

  const eventPosts = posts.filter(isEventPost);
  const details = [];
  let totalScore = 0;

  for (const post of eventPosts) {
    const result = calculatePostScore(
      post,
      categoryMap,
      teamSetting.categoryScores
    );

    totalScore += result.score;

    details.push({
      id: post.id,
      title: post.title?.rendered ?? '(タイトル不明)',
      date: post.date.slice(0, 10),
      categories: result.categoryNames.join(', '),
      score: result.score,
      url: post.link
    });
  }

  return {
    teamName: teamSetting.tagName,
    totalScore,
    postCount: eventPosts.length,
    details
  };
}


/* =========================================================
 * 得点表示
 * 0番目 = レポート
 * 1番目 = 緊急ミッション
 * XはID指定
 * ========================================================= */

function showMissionScores() {
  setText(getScoreElement('dimensional', 1), `${I} P`);
  setText(getScoreElement('presence', 1), `${P} P`);
}

function showReportLoading() {
  setText(getScoreElement('dimensional', 0), '計算中...');
  setText(getScoreElement('presence', 0), '計算中...');
}

function showReportError() {
  setText(getScoreElement('dimensional', 0), '取得失敗');
  setText(getScoreElement('presence', 0), '取得失敗');
}

function getTotalValues() {
  if (
    SCORE_STATE.report.error ||
    SCORE_STATE.x.error ||
    !SCORE_STATE.report.loaded ||
    !SCORE_STATE.x.loaded
  ) {
    return null;
  }

  return {
    dimensional:
      SCORE_STATE.report.dimensional +
      SCORE_STATE.mission.dimensional +
      SCORE_STATE.x.dimensional,

    presence:
      SCORE_STATE.report.presence +
      SCORE_STATE.mission.presence +
      SCORE_STATE.x.presence
  };
}

function updatePublicScoreState() {
  const total = getTotalValues();

  window.invisibleBeastsScore = {
    report: {
      ...SCORE_STATE.report
    },
    mission: {
      ...SCORE_STATE.mission
    },
    x: {
      ...SCORE_STATE.x
    },
    total,
    updatedAt: new Date()
  };
}

function updateTotalScores() {
  const dimensional =
    document.getElementById('total-score-dimensional');

  const presence =
    document.getElementById('total-score-presence');

  updatePublicScoreState();

  if (!dimensional || !presence) {
    return;
  }

  if (SCORE_STATE.report.error || SCORE_STATE.x.error) {
    dimensional.textContent = '取得失敗';
    presence.textContent = '取得失敗';
    return;
  }

  const total = getTotalValues();

  if (!total) {
    dimensional.textContent = '計算中...';
    presence.textContent = '計算中...';
    return;
  }

  dimensional.textContent = `${total.dimensional} P`;
  presence.textContent = `${total.presence} P`;
}


/* =========================================================
 * レポート得点更新
 * ========================================================= */

async function updateReportScores() {
  SCORE_STATE.report.loaded = false;
  SCORE_STATE.report.error = false;

  showReportLoading();
  updateTotalScores();

  try {
    const categoryMap = await getCategoryMap();

    const [dimensional, presence] = await Promise.all([
      calculateTeam(TEAM_SETTINGS.dimensional, categoryMap),
      calculateTeam(TEAM_SETTINGS.presence, categoryMap)
    ]);

    setText(
      getScoreElement('dimensional', 0),
      `${dimensional.totalScore} P`
    );

    setText(
      getScoreElement('presence', 0),
      `${presence.totalScore} P`
    );

    SCORE_STATE.report.dimensional =
      Number(dimensional.totalScore) || 0;

    SCORE_STATE.report.presence =
      Number(presence.totalScore) || 0;

    SCORE_STATE.report.loaded = true;
    SCORE_STATE.report.error = false;

    console.log('=== レポート得点 ===');

    console.log(
      `${dimensional.teamName}: ` +
      `${dimensional.totalScore}P / ` +
      `${dimensional.postCount}記事`
    );
    console.table(dimensional.details);

    console.log(
      `${presence.teamName}: ` +
      `${presence.totalScore}P / ` +
      `${presence.postCount}記事`
    );
    console.table(presence.details);
  } catch (error) {
    console.error('レポート得点の取得に失敗しました。', error);

    SCORE_STATE.report.loaded = false;
    SCORE_STATE.report.error = true;

    showReportError();
  }

  updateTotalScores();
}


/* =========================================================
 * GAS JSONP
 * ========================================================= */

function gasRequest(params) {
  return new Promise((resolve, reject) => {
    if (!GAS_URL || GAS_URL.includes('ここにGAS')) {
      reject(new Error('GAS_URLが設定されていません。'));
      return;
    }

    const callbackName =
      '__gas_callback_' +
      Date.now() +
      '_' +
      Math.floor(Math.random() * 1000000);

    const script = document.createElement('script');
    let finished = false;
    let timer = null;

    function cleanup() {
      if (finished) {
        return;
      }

      finished = true;

      if (timer !== null) {
        clearTimeout(timer);
      }

      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }

      script.remove();
    }

    window[callbackName] = data => {
      cleanup();
      resolve(data);
    };

    const query = new URLSearchParams({
      ...params,
      callback: callbackName,
      nonce: String(Date.now())
    });

    script.src = `${GAS_URL}?${query.toString()}`;
    script.async = true;

    script.onerror = () => {
      cleanup();
      reject(new Error('GASとの通信に失敗しました。'));
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('GASとの通信がタイムアウトしました。'));
    }, 15000);

    document.body.appendChild(script);
  });
}


/* =========================================================
 * X URL
 * ========================================================= */

function normalizeXPostUrl(inputUrl) {
  const raw = String(inputUrl || '').trim();

  if (!raw) {
    throw new Error('X投稿のURLを入力してください。');
  }

  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error('URLの形式が正しくありません。');
  }

  const allowedHosts = new Set([
    'x.com',
    'www.x.com',
    'twitter.com',
    'www.twitter.com'
  ]);

  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(
      'X（x.com / twitter.com）の投稿URLを入力してください。'
    );
  }

  let match = url.pathname.match(
    /^\/([A-Za-z0-9_]+)\/status\/(\d+)\/?$/
  );

  if (match) {
    return {
      id: match[2],
      url: `https://x.com/${match[1]}/status/${match[2]}`
    };
  }

  match = url.pathname.match(
    /^\/i\/web\/status\/(\d+)\/?$/
  );

  if (match) {
    return {
      id: match[1],
      url: `https://x.com/i/web/status/${match[1]}`
    };
  }

  throw new Error(
    '投稿の「status/数字」まで含むXのURLを入力してください。'
  );
}


/* =========================================================
 * Xフォーム
 * ========================================================= */

function showXMessage(text, type = '') {
  const element = document.getElementById('x-message');

  if (!element) {
    return;
  }

  element.textContent = text;
  element.className = 'form-message';

  if (type) {
    element.classList.add(type);
  }
}

function resetXPreviewState() {
  X_FORM_STATE.previewedPostId = '';
  X_FORM_STATE.previewedUrl = '';
  X_FORM_STATE.previewResult = null;
}

function clearXPreview() {
  const preview = document.getElementById('x-preview');
  const info = document.getElementById('x-post-info');
  const submitArea = document.getElementById('x-submit-area');

  if (preview) {
    preview.replaceChildren();
  }

  if (info) {
    info.classList.add('hidden');
  }

  if (submitArea) {
    submitArea.classList.add('hidden');
  }

  resetXPreviewState();
}

function setXInfo(id, text) {
  setText(document.getElementById(id), text);
}

function updateXPointPreview() {
  const select = document.getElementById('x-post-type');
  const display = document.getElementById('x-point-preview');

  if (!select || !display) {
    return;
  }

  const points = X_POST_POINTS[select.value];

  if (!Number.isFinite(points)) {
    display.textContent = 'この投稿：判定不能';
    return;
  }

  let text = `この投稿：${points} P`;
  const preview = X_FORM_STATE.previewResult;

  if (preview) {
    if (
      select.value !== 'declaration' &&
      preview.hasTeamHashtag === false
    ) {
      text += '（通常のX得点にはチームハッシュタグが必要です）';
    }

    if (
      (select.value === 'link' || select.value === 'fanmade_link') &&
      !preview.hasOfficialLink
    ) {
      text += '（対象URLを自動確認できていません）';
    }

    if (
      (select.value === 'fanmade' || select.value === 'fanmade_link') &&
      !preview.hasMedia
    ) {
      text += '（画像を自動確認できていません）';
    }

    if (select.value === 'declaration') {
      text += '（公式固定ポストの引用か管理者確認が必要です）';
    }
  }

  display.textContent = text;
}


/* =========================================================
 * X投稿確認
 * ========================================================= */

async function previewXPost() {
  const input = document.getElementById('x-post-url');
  const button = document.getElementById('x-preview-button');

  if (!input) {
    return;
  }

  let normalized;

  try {
    normalized = normalizeXPostUrl(input.value);
  } catch (error) {
    clearXPreview();
    showXMessage(error.message, 'error');
    return;
  }

  clearXPreview();
  showXMessage('投稿を確認しています...');

  if (button) {
    button.disabled = true;
  }

  try {
    const result = await gasRequest({
      action: 'preview',
      url: normalized.url
    });

    if (!result?.success) {
      throw new Error(
        result?.message || '投稿を確認できませんでした。'
      );
    }

    setXInfo('x-author', result.authorName || '不明');
    setXInfo('x-team', result.teamLabel || '判定不能');

    setXInfo(
      'x-media',
      result.hasMedia ? 'あり' : '自動検出なし'
    );

    setXInfo(
      'x-official-link',
      result.hasOfficialLink ? '検出' : '自動検出なし'
    );

    document
      .getElementById('x-post-info')
      ?.classList.remove('hidden');

    const preview = document.getElementById('x-preview');

    if (preview) {
      preview.innerHTML = String(result.html || '');

      if (window.twttr?.widgets?.load) {
        window.twttr.widgets.load(preview);
      }
    }

    if (!result.canSubmit) {
      showXMessage(
        '所属チームを投稿内容から確認できませんでした。',
        'error'
      );
      return;
    }

    X_FORM_STATE.previewedPostId =
      String(result.postId || normalized.id);

    X_FORM_STATE.previewedUrl =
      result.url || normalized.url;

    X_FORM_STATE.previewResult = result;

    const typeSelect =
      document.getElementById('x-post-type');

    if (typeSelect) {
      if (result.hasOfficialLink && result.hasMedia) {
        typeSelect.value = 'fanmade_link';
      } else if (result.hasMedia) {
        typeSelect.value = 'fanmade';
      } else if (result.hasOfficialLink) {
        typeSelect.value = 'link';
      } else {
        typeSelect.value = 'normal';
      }
    }

    document
      .getElementById('x-submit-area')
      ?.classList.remove('hidden');

    updateXPointPreview();

    if (result.isEventPeriod === false) {
      showXMessage(
        'この投稿は大投稿祭の対象期間外ですが、送信できます。投稿種別を確認して送信してください。'
      );
    }
    else {
      showXMessage(
        '投稿を確認できました。投稿種別を確認して送信してください。',
        'success'
      );
    }
  } catch (error) {
    console.error('X投稿の確認に失敗しました。', error);

    clearXPreview();

    showXMessage(
      error.message || 'X投稿の確認に失敗しました。',
      'error'
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}


/* =========================================================
 * X投稿送信
 * ========================================================= */

async function submitXPost() {
  const urlInput = document.getElementById('x-post-url');
  const typeSelect = document.getElementById('x-post-type');
  const submitButton = document.getElementById('x-submit-button');
  const previewButton = document.getElementById('x-preview-button');

  if (!urlInput || !typeSelect || !submitButton) {
    return;
  }

  if (X_FORM_STATE.submitting) {
    return;
  }

  let normalized;

  try {
    normalized = normalizeXPostUrl(urlInput.value);
  } catch (error) {
    showXMessage(error.message, 'error');
    return;
  }

  if (
    !X_FORM_STATE.previewedPostId ||
    normalized.id !== X_FORM_STATE.previewedPostId
  ) {
    clearXPreview();

    showXMessage(
      'URLが変更されています。「投稿を確認」をもう一度押してください。',
      'error'
    );
    return;
  }

  const type = typeSelect.value;

  if (
    !Object.prototype.hasOwnProperty.call(
      X_POST_POINTS,
      type
    )
  ) {
    showXMessage('投稿種別が正しくありません。', 'error');
    return;
  }

  X_FORM_STATE.submitting = true;
  submitButton.disabled = true;

  if (previewButton) {
    previewButton.disabled = true;
  }

  showXMessage('送信しています...');

  try {
    const result = await gasRequest({
      action: 'submit',
      url: X_FORM_STATE.previewedUrl,
      type
    });

    if (!result?.success) {
      throw new Error(
        result?.message || '送信に失敗しました。'
      );
    }

    const points = Number(result.points);

    showXMessage(
      `送信しました。${
        Number.isFinite(points)
          ? points
          : X_POST_POINTS[type]
      }Pとして「未確認」で登録されました。`,
      'success'
    );

    urlInput.value = '';
    clearXPreview();
    typeSelect.value = 'normal';

    await loadXScores();
  } catch (error) {
    console.error('X投稿の送信に失敗しました。', error);

    showXMessage(
      error.message || 'X投稿の送信に失敗しました。',
      'error'
    );
  } finally {
    X_FORM_STATE.submitting = false;
    submitButton.disabled = false;

    if (previewButton) {
      previewButton.disabled = false;
    }
  }
}


/* =========================================================
 * X承認済み得点
 * ========================================================= */

async function loadXScores() {
  const dimensional =
    document.getElementById('x-score-dimensional');

  const presence =
    document.getElementById('x-score-presence');

  if (!dimensional || !presence) {
    console.warn('X得点の表示欄が見つかりません。');
    return;
  }

  dimensional.textContent = '計算中...';
  presence.textContent = '計算中...';

  SCORE_STATE.x.loaded = false;
  SCORE_STATE.x.error = false;
  updateTotalScores();

  try {
    const result = await gasRequest({
      action: 'scores'
    });

    if (!result?.success) {
      throw new Error(
        result?.message || 'X得点を取得できませんでした。'
      );
    }

    const dimensionalScore = Number(result.dimensional);
    const presenceScore = Number(result.presence);

    if (
      !Number.isFinite(dimensionalScore) ||
      !Number.isFinite(presenceScore)
    ) {
      throw new Error('GASから受け取ったX得点が不正です。');
    }

    dimensional.textContent = `${dimensionalScore} P`;
    presence.textContent = `${presenceScore} P`;

    /* 総合点用に必ず保存 */
    SCORE_STATE.x.dimensional = dimensionalScore;
    SCORE_STATE.x.presence = presenceScore;
    SCORE_STATE.x.loaded = true;
    SCORE_STATE.x.error = false;
  } catch (error) {
    console.error('X得点の取得に失敗しました。', error);

    dimensional.textContent = '取得失敗';
    presence.textContent = '取得失敗';

    SCORE_STATE.x.loaded = false;
    SCORE_STATE.x.error = true;
  }

  updateTotalScores();
}


/* =========================================================
 * 初期化
 * ========================================================= */

function initializeXForm() {
  const previewButton =
    document.getElementById('x-preview-button');

  const submitButton =
    document.getElementById('x-submit-button');

  const typeSelect =
    document.getElementById('x-post-type');

  const urlInput =
    document.getElementById('x-post-url');

  previewButton?.addEventListener('click', previewXPost);
  submitButton?.addEventListener('click', submitXPost);
  typeSelect?.addEventListener('change', updateXPointPreview);

  urlInput?.addEventListener('input', () => {
    if (!X_FORM_STATE.previewedPostId) {
      return;
    }

    let currentId = '';

    try {
      currentId = normalizeXPostUrl(urlInput.value).id;
    } catch {
      currentId = '';
    }

    if (currentId !== X_FORM_STATE.previewedPostId) {
      clearXPreview();

      showXMessage(
        'URLが変更されたため、投稿をもう一度確認してください。'
      );
    }
  });

  urlInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      previewXPost();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  showMissionScores();
  updateTotalScores();
  initializeXForm();

  updateReportScores();
  loadXScores();
});
