"""Gráfico Matplotlib: modo real SQLite y modo demo con datos ficticios explícitos.

La serie de demostración solo existe en memoria; jamás modifica evidencias.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO
from threading import Lock

_CHART_LOCK = Lock()


def demonstration_activity_by_day() -> list[dict]:
    """Serie sintética reproducible. Nunca se escribe en SQLite."""
    samples = [
        (3, 1, 0),
        (5, 2, 1),
        (4, 3, 1),
        (6, 4, 2),
        (7, 3, 1),
        (10, 5, 2),
        (8, 6, 3),
    ]
    today = datetime.now(timezone.utc).date()
    return [
        {
            "date": (today - timedelta(days=6 - index)).isoformat(),
            "PENDIENTE": pending,
            "CONFIRMADA": confirmed,
            "DESCARTADA": discarded,
        }
        for index, (pending, confirmed, discarded) in enumerate(samples)
    ]


def render_activity_png(daily: list[dict], *, demo: bool = False) -> bytes:
    """Renderiza datos reales o, cuando demo=True, datos sintéticos identificados."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    with _CHART_LOCK:
        labels = [row["date"][5:] for row in daily]
        states = [
            ("PENDIENTE", "Pendientes", "#F4B959"),
            ("CONFIRMADA", "Confirmadas", "#30D98A"),
            ("DESCARTADA", "Descartadas", "#FA827F"),
        ]
        fig, ax = plt.subplots(figsize=(10, 3.65), dpi=135)
        fig.patch.set_facecolor("#0B231B")
        ax.set_facecolor("#0B231B")
        try:
            bottoms = [0] * len(labels)
            for status, description, color in states:
                heights = [int(row.get(status, 0)) for row in daily]
                ax.bar(
                    labels,
                    heights,
                    bottom=bottoms,
                    label=description,
                    color=color,
                    width=0.55,
                    edgecolor="#0B231B",
                    linewidth=1.3,
                )
                bottoms = [before + value for before, value in zip(bottoms, heights)]
            highest = max(bottoms, default=0)
            ax.set_ylim(0, max(3, highest * 1.22 + 1))
            ax.set_ylabel(
                "Capturas registradas", color="#AFD4C0", fontsize=10, labelpad=9
            )
            ax.tick_params(axis="x", colors="#C9EBDA", labelsize=10, length=0, pad=11)
            ax.tick_params(axis="y", colors="#A4C7B3", labelsize=9, length=0, pad=6)
            ax.yaxis.grid(True, color="#294839", alpha=0.85)
            ax.set_axisbelow(True)
            for spine in ax.spines.values():
                spine.set_visible(False)
            ax.legend(
                loc="upper left",
                ncol=3,
                frameon=False,
                fontsize=9,
                labelcolor="#D9F4E6",
                bbox_to_anchor=(0, 1.10),
            )
            ax.set_title(
                ("DATOS SIMULADOS · actividad ficticia · 7 días (UTC)"
                 if demo else "Actividad real del historial · últimos 7 días (UTC)"),
                fontsize=13,
                fontweight="bold",
                color="#F4FFF8",
                loc="left",
                pad=42,
            )
            if demo:
                ax.text(
                    0.98, 0.94, "DEMO · NO SON DETECCIONES REALES",
                    transform=ax.transAxes, ha="right", va="top",
                    color="#FFD49A", fontsize=8, fontweight="bold",
                    bbox={"facecolor": "#583719", "edgecolor": "#8F662A", "boxstyle": "round,pad=0.35"},
                )
            if highest == 0:
                ax.text(
                    0.5,
                    0.52,
                    "Aún no hay capturas guardadas",
                    transform=ax.transAxes,
                    ha="center",
                    va="center",
                    color="#A6CEB8",
                    fontsize=13,
                    fontweight="bold",
                )
            else:
                for i, count in enumerate(bottoms):
                    if count:
                        ax.text(
                            i,
                            count + 0.06,
                            str(count),
                            ha="center",
                            va="bottom",
                            fontsize=9,
                            color="#E5FAEE",
                            fontweight="bold",
                        )
            fig.subplots_adjust(top=0.72, bottom=0.16, left=0.09, right=0.97)
            buffer = BytesIO()
            fig.savefig(buffer, format="png", dpi=135, facecolor=fig.get_facecolor())
            return buffer.getvalue()
        finally:
            plt.close(fig)
