"""レポート：Claude・ChatGPT が記録（筋トレ・食事・体組成・睡眠・心拍・歩数）を読んで書いたまとめ。

MCP の save_report で保存し、同期（種類 report）でアプリに届ける。アプリは読むのと消すのだけ（書き換えない）。
依存の向きは、presentation → application → domain ← infrastructure、infrastructure → sync。
"""
