"""レポートの決まりに反したときの例外。理由は利用者（と AI）にそのまま見せる文にする。"""


class ReportError(Exception):
    """決まりに反した入力。"""


class NotFound(ReportError):
    """指したレポートがない（ほかの人のレポートも、ないものとして扱う）。"""
