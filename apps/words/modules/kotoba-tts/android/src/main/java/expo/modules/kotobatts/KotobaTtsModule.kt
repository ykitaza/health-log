package expo.modules.kotobatts

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * 端末の読み上げ（Android の TextToSpeech。Pixel では Google の音声）で、文を音声のファイル（WAV）に書き出すだけの小さなモジュール。
 * expo-speech はファイルに書けないので足した。書き出したファイルは、聞くの画面が expo-audio の再生の並びで鳴らし、鳴らし終えたら消す。
 * iOS は使わない（iOS では expo-speech でその場で読む）
 *
 * 書き出せないときは、理由（エンジンの起動の結果・日本語の音声データの有無・エラーの番号）を例外の message に入れる。
 * 聞くの画面がそれをそのまま出すので、持ち主が画面で原因を伝えられる
 */
class KotobaTtsModule : Module() {
  private val lock = Any()
  private var tts: TextToSpeech? = null
  private var ready = false
  private var initializing = false
  /** エンジンを作り直すたびに増やす（古いエンジンの知らせを捨てるため） */
  private var generation = 0
  private val waiting = mutableListOf<(String?) -> Unit>()
  private val pending = ConcurrentHashMap<String, Pair<Promise, String>>()

  private val progress = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String) {}
    override fun onDone(utteranceId: String) {
      pending.remove(utteranceId)?.let { (promise, path) -> promise.resolve(path) }
    }
    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String) {
      pending.remove(utteranceId)?.let { (promise, _) -> promise.reject(SynthesisException("エンジンがエラーを返しました")) }
    }
    override fun onError(utteranceId: String, errorCode: Int) {
      pending.remove(utteranceId)?.let { (promise, _) -> promise.reject(SynthesisException(describeError(errorCode))) }
    }
  }

  /** エンジンの用意ができたら null を、できなかったら理由を渡して block を呼ぶ。失敗したら、次の呼び出しで作り直す */
  private fun withEngine(block: (String?) -> Unit) {
    // -2：用意ができている。-1：作っている途中（待つ）。0 以上：ここで作る（その世代）
    val step: Int = synchronized(lock) {
      if (ready) {
        -2
      } else if (initializing) {
        waiting.add(block)
        -1
      } else {
        waiting.add(block)
        initializing = true
        generation += 1
        generation
      }
    }
    if (step == -2) { block(null); return }
    if (step == -1) return
    val gen = step
    val context = appContext.reactContext
    if (context == null) {
      onEngineInit(gen, TextToSpeech.ERROR, "アプリの準備ができていません")
      return
    }
    val engine: TextToSpeech
    try {
      // 失敗のときは、この中で（作り終える前に）知らせが来ることがある
      engine = TextToSpeech(context) { status -> onEngineInit(gen, status, null) }
    } catch (e: Exception) {
      onEngineInit(gen, TextToSpeech.ERROR, "読み上げのエンジンを作れません（${e.javaClass.simpleName}: ${e.message}）")
      return
    }
    engine.setOnUtteranceProgressListener(progress)
    val keep: Boolean = synchronized(lock) {
      if (gen == generation && (initializing || ready)) {
        tts = engine
        true
      } else {
        false
      }
    }
    if (!keep) engine.shutdown()
  }

  private fun onEngineInit(gen: Int, status: Int, detail: String?) {
    val reason: String? = if (status == TextToSpeech.SUCCESS) null else (detail ?: "読み上げのエンジンを起動できません（status=$status）")
    var dead: TextToSpeech? = null
    val current: Boolean = synchronized(lock) {
      if (gen != generation) {
        false
      } else {
        initializing = false
        ready = reason == null
        if (reason != null) {
          dead = tts
          tts = null
        }
        true
      }
    }
    if (!current) return
    dead?.shutdown()
    flush(reason)
  }

  private fun flush(reason: String?) {
    val list = synchronized(lock) { waiting.toList().also { waiting.clear() } }
    list.forEach { it(reason) }
  }

  private fun currentEngine(): TextToSpeech? = synchronized(lock) { tts }

  /** 日本語で書き出せなければ理由（書き出せれば null） */
  private fun languageProblem(engine: TextToSpeech): String? {
    val result = engine.isLanguageAvailable(Locale.JAPAN)
    return when {
      result >= TextToSpeech.LANG_AVAILABLE -> null
      result == TextToSpeech.LANG_MISSING_DATA ->
        "日本語の音声データが端末に入っていません（設定の「音声出力」で日本語の音声を入れてください。エンジン：${engine.defaultEngine}）"
      else -> "読み上げのエンジンが日本語に対応していません（エンジン：${engine.defaultEngine}、結果=$result）"
    }
  }

  override fun definition() = ModuleDefinition {
    Name("KotobaTts")

    /** 日本語の読み上げが使えるか */
    AsyncFunction("isAvailable") { promise: Promise ->
      withEngine { reason ->
        val engine = currentEngine()
        promise.resolve(reason == null && engine != null && languageProblem(engine) == null)
      }
    }

    /** 日本語の読み上げをファイルに書き出せるか。書き出せれば null、書き出せなければ理由 */
    AsyncFunction("diagnose") { promise: Promise ->
      withEngine { reason ->
        val engine = currentEngine()
        val problem: String? = when {
          reason != null -> reason
          engine == null -> "読み上げのエンジンがありません"
          else -> languageProblem(engine)
        }
        promise.resolve(problem)
      }
    }

    /** text を読み上げた音声を path（file:// でない、ふつうのパス）に書き出し、書き終えたら path を返す */
    AsyncFunction("synthesizeToFile") { text: String, path: String, rate: Double, promise: Promise ->
      withEngine { reason ->
        val engine = currentEngine()
        if (reason != null || engine == null) {
          promise.reject(UnavailableException(reason ?: "読み上げのエンジンがありません"))
          return@withEngine
        }
        val lang = engine.setLanguage(Locale.JAPAN)
        if (lang < TextToSpeech.LANG_AVAILABLE) {
          promise.reject(UnavailableException(languageProblem(engine) ?: "日本語を選べません（結果=$lang）"))
          return@withEngine
        }
        if (text.length > TextToSpeech.getMaxSpeechInputLength()) {
          promise.reject(SynthesisException("文が長すぎます（${text.length}文字）"))
          return@withEngine
        }
        engine.setSpeechRate(rate.toFloat())
        val file = File(path)
        file.parentFile?.mkdirs()
        val id = UUID.randomUUID().toString()
        pending[id] = promise to path
        val result: Int = try {
          engine.synthesizeToFile(text, Bundle(), file, id)
        } catch (e: Exception) {
          pending.remove(id)
          promise.reject(SynthesisException("${e.javaClass.simpleName}: ${e.message}"))
          return@withEngine
        }
        if (result != TextToSpeech.SUCCESS) {
          if (pending.remove(id) != null) promise.reject(SynthesisException("書き出しを始められません（結果=$result）"))
        }
      }
    }

    OnDestroy {
      val engine: TextToSpeech? = synchronized(lock) {
        generation += 1
        ready = false
        initializing = false
        waiting.clear()
        tts.also { tts = null }
      }
      engine?.shutdown()
      pending.clear()
    }
  }
}

/** UtteranceProgressListener.onError の番号を、人が読める理由にする */
private fun describeError(code: Int): String = when (code) {
  TextToSpeech.ERROR_SYNTHESIS -> "音声を作れませんでした（ERROR_SYNTHESIS）"
  TextToSpeech.ERROR_SERVICE -> "読み上げのサービスのエラー（ERROR_SERVICE）"
  TextToSpeech.ERROR_OUTPUT -> "ファイルに書けませんでした（ERROR_OUTPUT）"
  TextToSpeech.ERROR_NETWORK -> "通信のエラー（ERROR_NETWORK）"
  TextToSpeech.ERROR_NETWORK_TIMEOUT -> "通信の時間切れ（ERROR_NETWORK_TIMEOUT）"
  TextToSpeech.ERROR_INVALID_REQUEST -> "読み上げの頼み方が正しくありません（ERROR_INVALID_REQUEST）"
  TextToSpeech.ERROR_NOT_INSTALLED_YET -> "日本語の音声データをまだ入れ終えていません（ERROR_NOT_INSTALLED_YET）"
  else -> "エラー（番号=$code）"
}

class UnavailableException(detail: String) : CodedException(detail)
class SynthesisException(detail: String) : CodedException("ファイルに書き出せませんでした：$detail")
