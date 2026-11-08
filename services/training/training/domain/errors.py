"""筋トレのドメインの決まりに反したときの例外。理由は利用者（と AI）にそのまま見せる文にする。"""


class TrainingError(Exception):
    """決まりに反した入力。"""


class NotFound(TrainingError):
    """指した記録がない（ほかの人の記録も、ないものとして扱う）。"""
