from datamedic.tools.validation import (
    AGGREGATION_FUNCS,
    normalize_departments,
    period_key,
    period_mask,
    validate_aggregation,
    validate_chart_type,
    validate_department_name,
    validate_group_by,
    validate_metric,
    validate_period,
    validate_sort,
    validate_top_n,
)


class TestValidatePeriod:
    def test_valid_period_returns_none(self):
        assert validate_period(2024, 2025, 1, 12) is None

    def test_same_year_single_month(self):
        assert validate_period(2024, 2024, 3, 3) is None

    def test_invalid_month_returns_error(self):
        error = validate_period(2024, 2024, 0, 12)
        assert error is not None
        assert "月份" in error

    def test_month_end_invalid_returns_error(self):
        error = validate_period(2024, 2024, 1, 13)
        assert error is not None
        assert "月份" in error

    def test_start_after_end_returns_error(self):
        error = validate_period(2024, 2023, 1, 12)
        assert error is not None
        assert "开始时间" in error

    def test_same_year_start_month_after_end_month_returns_error(self):
        error = validate_period(2024, 2024, 6, 3)
        assert error is not None
        assert "开始时间" in error


class TestPeriodKey:
    def test_converts_year_month_to_ordered_key(self):
        assert period_key(2024, 1) == 202401
        assert period_key(2024, 12) == 202412
        assert period_key(2025, 1) == 202501

    def test_ordering_is_correct(self):
        assert period_key(2024, 12) < period_key(2025, 1)


class TestNormalizeDepartments:
    def test_returns_all_departments_when_list_is_empty(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科", "心内科", "儿科"],
        )
        result = normalize_departments([])
        assert result.error is None
        assert set(result.departments) == {"骨科", "心内科", "儿科"}

    def test_returns_all_departments_when_none_is_passed(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科", "心内科"],
        )
        result = normalize_departments(None)
        assert result.error is None
        assert set(result.departments) == {"骨科", "心内科"}

    def test_normalizes_known_departments(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科", "心内科", "儿科"],
        )
        result = normalize_departments(["骨科", "心内科"])
        assert result.error is None
        assert result.departments == ["骨科", "心内科"]

    def test_strips_whitespace_from_department_names(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科", "心内科"],
        )
        result = normalize_departments(["  骨科  "])
        assert result.error is None
        assert result.departments == ["骨科"]

    def test_returns_error_for_unknown_department(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科", "心内科"],
        )
        result = normalize_departments(["骨科", "整形外科"])
        assert result.error is not None
        assert "整形外科" in result.error
        assert result.departments == []

    def test_filters_out_blank_strings(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科"],
        )
        result = normalize_departments(["骨科", "  ", ""])
        assert result.error is None
        assert result.departments == ["骨科"]


class TestValidateDepartmentName:
    def test_valid_name_returns_none(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科", "心内科"],
        )
        assert validate_department_name("骨科") is None

    def test_unknown_name_returns_error(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科"],
        )
        error = validate_department_name("整形外科")
        assert error is not None
        assert "整形外科" in error

    def test_blank_name_returns_error(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_departments",
            lambda: ["骨科"],
        )
        assert validate_department_name("  ") is not None


class TestValidateMetric:
    def test_valid_metric_returns_none(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_metrics",
            lambda: [{"name": "门诊人次"}],
        )
        assert validate_metric("门诊人次") is None

    def test_unknown_metric_returns_error(self, monkeypatch):
        monkeypatch.setattr(
            "datamedic.tools.validation.get_metrics",
            lambda: [{"name": "门诊人次"}],
        )
        error = validate_metric("手术量")
        assert error is not None
        assert "手术量" in error


class TestValidateAggregation:
    def test_valid_aggregations(self):
        for agg in ["none", "sum", "avg", "max", "min"]:
            assert validate_aggregation(agg) is None

    def test_invalid_aggregation_returns_error(self):
        error = validate_aggregation("median")
        assert error is not None
        assert "median" in error


class TestValidateSort:
    def test_valid_sorts(self):
        for sort in ["none", "value_asc", "value_desc"]:
            assert validate_sort(sort) is None

    def test_invalid_sort_returns_error(self):
        error = validate_sort("alphabetical")
        assert error is not None
        assert "alphabetical" in error


class TestValidateChartType:
    def test_valid_chart_types(self):
        for chart_type in ["line", "bar", "scatter", "pie", "table", "waterfall"]:
            assert validate_chart_type(chart_type) is None

    def test_invalid_chart_type_returns_error(self):
        error = validate_chart_type("gantt")
        assert error is not None
        assert "gantt" in error


class TestValidateGroupBy:
    def test_valid_group_by(self):
        for gb in ["month", "year", "department"]:
            assert validate_group_by(gb) is None

    def test_invalid_group_by_returns_error(self):
        error = validate_group_by("quarter")
        assert error is not None
        assert "quarter" in error


class TestValidateTopN:
    def test_zero_and_positive_values_are_valid(self):
        assert validate_top_n(0) is None
        assert validate_top_n(10) is None

    def test_negative_value_returns_error(self):
        error = validate_top_n(-1)
        assert error is not None
        assert "负数" in error


class TestAggregationFuncs:
    def test_maps_none_to_mean(self):
        assert AGGREGATION_FUNCS["none"] == "mean"

    def test_maps_avg_to_mean(self):
        assert AGGREGATION_FUNCS["avg"] == "mean"
