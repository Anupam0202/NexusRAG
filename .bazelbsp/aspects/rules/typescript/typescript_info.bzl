load("//aspects:utils/utils.bzl", "create_struct", "file_location")

def extract_typescript_info(target, ctx, **kwargs):
    kind = getattr(ctx.rule, "kind", "")

    if kind == "jest_test":
        return _extract_jest_test_info(target, ctx)
    elif kind == "web_test":
        return _extract_web_test_info(target, ctx)

    return None, None

def _extract_jest_test_info(target, ctx):
    """Extract TypeScript info from jest_test targets (rules_jest / aspect_rules_jest)."""
    sources = []

    if hasattr(ctx.rule.attr, "srcs") and ctx.rule.attr.srcs:
        for src_file in ctx.rule.attr.srcs:
            if hasattr(src_file, "files"):
                for file in src_file.files.to_list():
                    sources.append(file.path)

    if hasattr(ctx.rule.attr, "data") and ctx.rule.attr.data:
        for data_file in ctx.rule.attr.data:
            if hasattr(data_file, "files"):
                for file in data_file.files.to_list():
                    sources.append(file.path)

    typescript_info = create_struct(
        sources = sources,
    )

    sources_as_file_locations = [create_struct(relative_path = s, is_source = True, is_external = False) for s in sources]

    return dict(
        typescript_target_info = typescript_info,
        sources = sources_as_file_locations,
    ), None

def _extract_web_test_info(target, ctx):
    """Extract TypeScript info from web_test targets (jazelle)."""

    # Exclude lint targets, which may use the same rule.
    if target.label.name in ["lint"]:
        return None, None

    source_paths = []
    source_file_locations = []

    if hasattr(ctx.rule.attr, "deps") and ctx.rule.attr.deps:
        package = ctx.label.package
        for dep in ctx.rule.attr.deps:
            if hasattr(dep, "files"):
                for file in dep.files.to_list():
                    if file.is_source and (not package or file.short_path.startswith(package + "/")):
                        source_paths.append(file.path)
                        source_file_locations.append(file_location(file))

    typescript_info = create_struct(
        sources = source_paths,
    )

    return dict(
        typescript_target_info = typescript_info,
        sources = source_file_locations,
    ), None
