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
 */
class KotobaTtsModule : Module() {
  private var tts: TextToSpeech? = null
  private var ready = false
  private val waiting = mutableListOf<(Boolean) -> Unit>()
  private val pending = ConcurrentHashMap<String, Pair<Promise, String>>()

  /** エンジンの用意ができたら（できなかったら false で）呼ぶ */
  private fun withEngine(block: (Boolean) -> Unit) {
    if (ready) { block(true); return }
    synchronized(waiting) { waiting.add(block) }
    if (tts != null) return
    val context = appContext.reactContext ?: run { flush(false); return }
    tts = TextToSpeech(context) { status ->
      val ok = status == TextToSpeech.SUCCESS
      if (ok) {
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String) {}
          override fun onDone(utteranceId: String) {
            pending.remove(utteranceId)?.let { (promise, path) -> promise.resolve(path) }
          }
          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String) {
            pending.remove(utteranceId)?.let { (promise, _) -> promise.reject(SynthesisException()) }
          }
          override fun onError(utteranceId: String, errorCode: Int) {
            pending.remove(utteranceId)?.let { (promise, _) -> promise.reject(SynthesisException()) }
          }
        })
      }
      ready = ok
      flush(ok)
    }
  }

  private fun flush(ok: Boolean) {
    val list = synchronized(waiting) { waiting.toList().also { waiting.clear() } }
    list.forEach { it(ok) }
  }

  override fun definition() = ModuleDefinition {
    Name("KotobaTts")

    /** 日本語の読み上げが使えるか */
    AsyncFunction("isAvailable") { promise: Promise ->
      withEngine { ok ->
        val lang = if (ok) tts?.isLanguageAvailable(Locale.JAPAN) ?: TextToSpeech.LANG_NOT_SUPPORTED else TextToSpeech.LANG_NOT_SUPPORTED
        promise.resolve(lang >= TextToSpeech.LANG_AVAILABLE)
      }
    }

    /** text を読み上げた音声を path（file:// でない、ふつうのパス）に書き出し、書き終えたら path を返す */
    AsyncFunction("synthesizeToFile") { text: String, path: String, rate: Double, promise: Promise ->
      withEngine { ok ->
        val engine = tts
        if (!ok || engine == null) { promise.reject(UnavailableException()); return@withEngine }
        engine.setLanguage(Locale.JAPAN)
        engine.setSpeechRate(rate.toFloat())
        val file = File(path)
        file.parentFile?.mkdirs()
        val id = UUID.randomUUID().toString()
        pending[id] = promise to path
        val result = engine.synthesizeToFile(text, Bundle(), file, id)
        if (result != TextToSpeech.SUCCESS) {
          pending.remove(id)
          promise.reject(SynthesisException())
        }
      }
    }

    OnDestroy {
      tts?.shutdown()
      tts = null
      ready = false
    }
  }
}

class UnavailableException : CodedException("端末の読み上げが使えません")
class SynthesisException : CodedException("読み上げをファイルに書き出せませんでした")
