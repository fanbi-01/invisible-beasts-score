'use strict';

/*
 * 不可視生物生態研究室「大投稿祭」得点集計
 *
 * ・レポートの得点
 *   → WordPress REST APIから自動取得
 *
 * ・緊急ミッションの得点
 *   → I / P の値を表示
 */


const API_BASE = 'https://invisible-beasts.com/wp-json/wp/v2';

const POSTS_PER_PAGE = 100;


// 大投稿祭の対象期間
const EVENT_START = '2026-08-01';
const EVENT_END = '2026-08-31';


/*
 * チームごとの設定
 */
const TEAM_SETTINGS = {

  dimensional: {

    tagName: 'チーム異次元',

    scoreSelector: '.score-dimensional',

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

    scoreSelector: '.score-presence',

    categoryScores: {

      '無気配生物': 10,

      '完全透過性生物': 5,

      '超擬態生物': 5,

      '関連文書': 5,

      '異次元生物': 3

    }

  }

};



/*
 * =========================
 * 緊急ミッション
 * =========================
 *
 * 必要に応じてここだけ変更
 */


// チーム異次元
const I = 100 * 0;


// チーム無気配
const P = 100 * 3;



/*
 * REST APIからJSONを取得
 */
async function fetchJson(url) {

  const response = await fetch(url, {

    method: 'GET',

    cache: 'no-store'

  });


  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status}: ${url}`
    );

  }


  return {

    data: await response.json(),

    response: response

  };

}



/*
 * WordPress REST APIの全ページを取得
 *
 * ページ数が増えても
 * 自動で最後まで取得する
 */
async function fetchAllPages(
  endpoint,
  params = {}
) {

  const allItems = [];


  let page = 1;

  let totalPages = null;


  while (true) {

    const url =
      new URL(
        `${API_BASE}/${endpoint}`
      );


    /*
     * パラメータ追加
     */
    for (
      const [key, value]
      of Object.entries(params)
    ) {

      url.searchParams.set(
        key,
        value
      );

    }


    url.searchParams.set(
      'per_page',
      POSTS_PER_PAGE
    );


    url.searchParams.set(
      'page',
      page
    );


    let result;


    try {

      result =
        await fetchJson(
          url.toString()
        );

    }
    catch (error) {

      /*
       * 総ページ数が取得できなかった場合
       *
       * 2ページ目以降でエラーになったら
       * 最後まで取得したと判断
       */

      if (
        page > 1 &&
        totalPages === null
      ) {

        break;

      }


      throw error;

    }


    const items =
      result.data;


    /*
     * 配列でなければ異常
     */
    if (!Array.isArray(items)) {

      throw new Error(
        `${endpoint} の応答形式が想定と異なります。`
      );

    }


    allItems.push(
      ...items
    );


    /*
     * WordPressが返す
     *
     * X-WP-TotalPages
     *
     * を確認
     */
    if (totalPages === null) {

      const header =
        result.response.headers.get(
          'X-WP-TotalPages'
        );


      const parsed =
        Number(header);


      if (
        Number.isFinite(parsed) &&
        parsed >= 1
      ) {

        totalPages =
          parsed;

      }

    }


    /*
     * 最終ページなら終了
     */
    if (
      totalPages !== null &&
      page >= totalPages
    ) {

      break;

    }


    /*
     * 総ページ数が取得できなかった場合
     *
     * 100件未満なら
     * 最終ページと判断
     */
    if (
      totalPages === null &&
      items.length < POSTS_PER_PAGE
    ) {

      break;

    }


    page++;

  }


  return allItems;

}



/*
 * タグ名
 *
 * ↓
 *
 * タグID
 *
 * を取得
 */
async function getTagId(
  tagName
) {

  const url =
    new URL(
      `${API_BASE}/tags`
    );


  url.searchParams.set(
    'search',
    tagName
  );


  url.searchParams.set(
    'per_page',
    100
  );


  const result =
    await fetchJson(
      url.toString()
    );


  const tags =
    result.data;


  /*
   * 完全一致するタグを探す
   */
  const exactTag =
    tags.find(
      tag =>
        tag.name.trim()
        ===
        tagName
    );


  if (!exactTag) {

    throw new Error(
      `タグ「${tagName}」が見つかりませんでした。`
    );

  }


  return exactTag.id;

}



/*
 * カテゴリID
 *
 * ↓
 *
 * カテゴリ名
 *
 * の対応表を作る
 */
async function getCategoryMap() {

  const categories =
    await fetchAllPages(
      'categories'
    );


  const map =
    new Map();


  for (
    const category
    of categories
  ) {

    map.set(

      category.id,

      category.name.trim()

    );

  }


  return map;

}



/*
 * 投稿が
 *
 * 2026/08/01
 *
 * ～
 *
 * 2026/08/31
 *
 * の期間内か確認
 */
function isEventPost(
  post
) {

  if (
    !post.date ||
    post.date.length < 10
  ) {

    return false;

  }


  const date =
    post.date.slice(
      0,
      10
    );


  return (

    date >= EVENT_START

    &&

    date <= EVENT_END

  );

}



/*
 * 1記事の得点を計算
 *
 * 複数カテゴリの場合は
 * 一番低い点数
 */
function calculatePostScore(
  post,
  categoryMap,
  categoryScores
) {

  /*
   * カテゴリID
   *
   * ↓
   *
   * カテゴリ名
   */
  const categoryNames =
    post.categories

      .map(
        id =>
          categoryMap.get(id)
      )

      .filter(Boolean);


  /*
   * 得点対象カテゴリだけ抽出
   */
  const scores =
    categoryNames

      .filter(
        name =>
          Object.hasOwn(
            categoryScores,
            name
          )
      )

      .map(
        name =>
          categoryScores[name]
      );


  /*
   * 複数カテゴリの場合は
   * 最低点
   *
   * 対象カテゴリがなければ0
   */
  const score =
    scores.length > 0
      ?
      Math.min(...scores)
      :
      0;


  return {

    score: score,

    categoryNames:
      categoryNames

  };

}



/*
 * 指定したチームの
 * レポート得点を計算
 */
async function calculateTeam(
  teamSetting,
  categoryMap
) {

  /*
   * タグIDを取得
   */
  const tagId =
    await getTagId(
      teamSetting.tagName
    );


  /*
   * タグ付き投稿を
   * 全件取得
   */
  const posts =
    await fetchAllPages(

      'posts',

      {

        tags:
          tagId,

        status:
          'publish',

        _fields:
          'id,date,link,title,categories'

      }

    );


  /*
   * 大投稿祭期間内だけ
   */
  const eventPosts =
    posts.filter(
      isEventPost
    );


  const details = [];


  let totalScore = 0;


  /*
   * 各記事を計算
   */
  for (
    const post
    of eventPosts
  ) {

    const result =
      calculatePostScore(

        post,

        categoryMap,

        teamSetting.categoryScores

      );


    totalScore +=
      result.score;


    details.push({

      id:
        post.id,


      title:
        post.title?.rendered
        ??
        '(タイトル不明)',


      date:
        post.date.slice(
          0,
          10
        ),


      categories:
        result.categoryNames.join(
          ', '
        ),


      score:
        result.score,


      url:
        post.link

    });

  }


  return {

    teamName:
      teamSetting.tagName,


    totalScore:
      totalScore,


    postCount:
      eventPosts.length,


    details:
      details

  };

}



/*
 * =========================
 * レポート得点表示
 * =========================
 *
 * 1つ目の
 * .score-dimensional
 *
 * .score-presence
 *
 * に表示する
 */
function showScore(
  selector,
  score
) {

  const element =
    document.querySelector(
      selector
    );


  if (!element) {

    console.warn(
      `表示先 ${selector} が見つかりません。`
    );

    return;

  }


  element.textContent =
    `${score} P`;

}



/*
 * =========================
 * 緊急ミッション得点表示
 * =========================
 *
 * 2つ目の得点欄へ
 * I / P を表示する
 */
function showMissionScores() {

  /*
   * チーム異次元の
   * 得点欄をすべて取得
   */
  const dimensionalScores =
    document.querySelectorAll(
      '.score-dimensional'
    );


  /*
   * チーム無気配の
   * 得点欄をすべて取得
   */
  const presenceScores =
    document.querySelectorAll(
      '.score-presence'
    );


  /*
   * 2つ目
   *
   * 緊急ミッション
   */
  if (
    dimensionalScores[1]
  ) {

    dimensionalScores[1]
      .textContent =
        `${I} P`;

  }


  if (
    presenceScores[1]
  ) {

    presenceScores[1]
      .textContent =
        `${P} P`;

  }

}



/*
 * レポート得点
 * 読み込み中表示
 */
function showLoading() {

  const dimensional =
    document.querySelector(
      '.score-dimensional'
    );


  const presence =
    document.querySelector(
      '.score-presence'
    );


  if (dimensional) {

    dimensional.textContent =
      '計算中...';

  }


  if (presence) {

    presence.textContent =
      '計算中...';

  }

}



/*
 * レポート得点の
 * 取得失敗表示
 */
function showError() {

  const dimensional =
    document.querySelector(
      '.score-dimensional'
    );


  const presence =
    document.querySelector(
      '.score-presence'
    );


  if (dimensional) {

    dimensional.textContent =
      '取得失敗';

  }


  if (presence) {

    presence.textContent =
      '取得失敗';

  }

}



/*
 * =========================
 * 全得点を更新
 * =========================
 */
async function updateScores() {

  /*
   * 1つ目の
   * レポート得点
   */
  showLoading();


  /*
   * 2つ目の
   * 緊急ミッション得点
   *
   * API通信不要なので
   * 先に表示
   */
  showMissionScores();


  try {

    /*
     * カテゴリ一覧を取得
     */
    const categoryMap =
      await getCategoryMap();


    /*
     * 両チームを
     * 同時に計算
     */
    const [

      dimensional,

      presence

    ] =
      await Promise.all([


        calculateTeam(

          TEAM_SETTINGS.dimensional,

          categoryMap

        ),


        calculateTeam(

          TEAM_SETTINGS.presence,

          categoryMap

        )


      ]);


    /*
     * =========================
     * レポート得点を表示
     * =========================
     */


    showScore(

      TEAM_SETTINGS
        .dimensional
        .scoreSelector,

      dimensional.totalScore

    );


    showScore(

      TEAM_SETTINGS
        .presence
        .scoreSelector,

      presence.totalScore

    );


    /*
     * =========================
     * Console
     * =========================
     */


    console.log(
      '=== 大投稿祭 レポート得点 ==='
    );


    console.log(

      `${dimensional.teamName}: ` +

      `${dimensional.totalScore}P / ` +

      `${dimensional.postCount}記事`

    );


    console.table(
      dimensional.details
    );


    console.log(

      `${presence.teamName}: ` +

      `${presence.totalScore}P / ` +

      `${presence.postCount}記事`

    );


    console.table(
      presence.details
    );


    /*
     * 緊急ミッション
     */
    console.log(
      '=== 緊急ミッション ==='
    );


    console.log(
      `チーム異次元: ${I}P`
    );


    console.log(
      `チーム無気配: ${P}P`
    );


    /*
     * 他のJavaScriptから
     * 得点を利用可能にする
     */
    window.invisibleBeastsScore = {

      dimensional:
        dimensional,

      presence:
        presence,


      mission: {

        dimensional:
          I,

        presence:
          P

      },


      updatedAt:
        new Date()

    };


  }
  catch (error) {

    console.error(

      '得点の取得・計算に失敗しました。',

      error

    );


    /*
     * レポート得点だけ
     * 取得失敗にする
     *
     * 緊急ミッションは
     * I / P の値なのでそのまま
     */
    showError();

  }

}



/*
 * HTML読み込み完了後に
 * 全得点を表示
 */
document.addEventListener(

  'DOMContentLoaded',

  updateScores

);